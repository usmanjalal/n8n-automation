import json
import sqlite3
import uuid
import datetime

workflow_path = '/Users/mac/Documents/GitHub/n8n/facebook_page_monitor_workflow.json'

with open(workflow_path, 'r', encoding='utf-8') as f:
    wf = json.load(f)

for node in wf['nodes']:
    if node['id'] == 'http-fetch-scraper-1':
        node['parameters']['options'] = {
            'timeout': 120000
        }
    elif node['id'] == 'code-split-pages-1':
        node['parameters']['jsCode'] = """const results = $input.item.json?.results || [];

let targetDestination = "Daily Task Update";
let targetRecipient = "Daily Task Update";

try {
  const wh = $("On-Demand Evo Bot Webhook").item?.json;
  if (wh) {
    targetDestination = wh.groupName || wh.targetDestination || targetDestination;
    targetRecipient = wh.groupJid || wh.phone || wh.targetRecipient || targetRecipient;
  }
} catch (_) {
  // Safe fallback when triggered manually or by daily schedule
}

return results.map(item => ({
  json: {
    page: item.page,
    page_name: item.page_name,
    last_post_iso: item.last_post_iso,
    post_url: item.post_url,
    targetDestination,
    targetRecipient
  }
}));"""
    elif node['id'] == 'code-eval-inactivity-1':
        node['parameters'] = {
            'mode': 'runOnceForEachItem',
            'jsCode': """// ====================================================================
// EVALUATE 48-HOUR INACTIVITY (ASIA/KARACHI TIME)
// ====================================================================
const item = $input.item.json;
const pageName = item.page_name || item.page;
const lastPostTime = new Date(item.last_post_iso).getTime();

// Calculate Karachi 2 calendar days cutoff
const tz = 'Asia/Karachi';
const now = new Date();
const karachiDateStr = now.toLocaleDateString('en-CA', { timeZone: tz });
const [todayY, todayM, todayD] = karachiDateStr.split('-').map(Number);

// Today 00:00:00 PKT in UTC milliseconds (PKT = UTC+5)
const todayStartUtc = Date.UTC(todayY, todayM - 1, todayD, -5, 0, 0);
const twoDaysAgoStartUtc = todayStartUtc - (48 * 60 * 60 * 1000);

// Inactive if last post was before 2 calendar days ago
const isInactive = lastPostTime < twoDaysAgoStartUtc;
const alertMessage = `${pageName} is inactive since 48 hours.`;

return {
  json: {
    ...item,
    pageName,
    is_inactive: isInactive,
    alertMessage,
    cutoff_date_karachi: new Date(twoDaysAgoStartUtc).toISOString()
  }
};"""
        }
    elif node['id'] == 'code-format-wa-1':
        node['parameters'] = {
            'mode': 'runOnceForAllItems',
            'jsCode': """const allItems = $input.all();
if (!allItems || allItems.length === 0) return [];

// Filter strictly to inactive items
const items = allItems.filter(it => it.json && it.json.is_inactive === true);

// If no page is inactive for more than 48 hours, return empty array (no message sent)
if (items.length === 0) return [];

const recipient = items[0].json.targetRecipient || 'Daily Task Update';
const destination = items[0].json.targetDestination || 'Daily Task Update';

// Helper to format Date & Time nicely in Pakistan Time
function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-US', {
      timeZone: 'Asia/Karachi',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (_) {
    return isoString;
  }
}

if (items.length === 1) {
  const item = items[0].json;
  const singleMsg = `The following page is inactive for more than 48 hours.\\n${item.pageName}: Last post on ${formatDateTime(item.last_post_iso)}`;
  return [{
    json: {
      pageName: item.pageName,
      message: singleMsg,
      targetRecipient: recipient,
      targetDestination: destination,
      timestamp: new Date().toISOString()
    }
  }];
}

const pageLines = items.map(it => `${it.json.pageName}: Last post on ${formatDateTime(it.json.last_post_iso)}`);
const multiMsg = `The following pages are inactive for more than 48 hours.\\n${pageLines.join('\\n')}`;

return [{
  json: {
    pageName: `${items.length} Inactive Pages`,
    message: multiMsg,
    targetRecipient: recipient,
    targetDestination: destination,
    timestamp: new Date().toISOString()
  }
}];"""
        }

with open(workflow_path, 'w', encoding='utf-8') as f:
    json.dump(wf, f, indent=2)

conn = sqlite3.connect('/Users/mac/.n8n/database.sqlite')
c = conn.cursor()

nodes_json = json.dumps(wf['nodes'])
connections_json = json.dumps(wf['connections'])
new_version_id = str(uuid.uuid4())
now = datetime.datetime.now(datetime.timezone.utc).isoformat()

c.execute('''
    UPDATE workflow_entity 
    SET nodes = ?, connections = ?, versionId = ?, activeVersionId = ?, updatedAt = ?
    WHERE id = 'fb-page-inactivity-monitor'
''', (nodes_json, connections_json, new_version_id, new_version_id, now))

row = c.execute("SELECT name, description, nodeGroups FROM workflow_entity WHERE id='fb-page-inactivity-monitor'").fetchone()
name, description, nodeGroups = row

c.execute('''
    INSERT INTO workflow_history (versionId, workflowId, nodes, connections, name, description, nodeGroups, createdAt, updatedAt, authors, autosaved)
    VALUES (?, 'fb-page-inactivity-monitor', ?, ?, ?, ?, ?, ?, ?, '[]', 0)
''', (new_version_id, nodes_json, connections_json, name, description, nodeGroups, now, now))

conn.commit()
conn.close()
print('Successfully synced workflow JSON and n8n database! New version:', new_version_id)
