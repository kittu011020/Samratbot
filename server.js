require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.WORKPLACE_PAGE_ACCESS_TOKEN;
const LOCKED_NAME = process.env.LOCKED_THREAD_NAME || "Locked Group";
const PORT = process.env.PORT || 3000;

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
  res.sendStatus(400);
});

// Webhook event receiver (POST)
app.post('/webhook', async (req, res) => {
  // Basic guard
  if (!req.body) return res.sendStatus(400);
  // Platform: Workplace/Messenger will POST events here
  try {
    const body = req.body;
    // For Workplace, thread events (rename) show up in "events" array (Workplace docs)
    // We'll scan payload for any indication of a thread rename and then reset the name.
    // NOTE: event structures vary by product version — log unknown events for debugging.
    console.log('Received webhook body:', JSON.stringify(body).slice(0,1000));

    // Example: Workplace sends `event` objects with type like `thread.name.changed` or `group_rename`.
    // We'll do a tolerant search for fields that look like a thread rename.
    const events = (body.entry && body.entry.flatMap(e => e.messaging || e.events || [])) || (body.events || []);
    for (const ev of events) {
      // Adapt to the event structure you receive. We'll check common keys:
      if (ev && (ev.thread_name || ev.thread_title || ev.thread || ev.event === 'thread_rename' || ev.type === 'rename' || (ev.change && ev.change.field === 'name'))) {
        // Determine thread ID
        const threadId = ev.thread_id || (ev.thread && ev.thread.id) || ev.sender && ev.sender.id || ev.group_id;
        if (threadId) {
          console.log('Detected rename in thread', threadId, '— enforcing locked name.');
          await enforceThreadName(threadId, LOCKED_NAME);
        } else {
          console.warn('Rename event detected but could not find thread id in event:', JSON.stringify(ev));
        }
      }
    }

    // Acknowledge receipt
    res.status(200).send('OK');
  } catch (err) {
    console.error('Error handling webhook:', err);
    res.sendStatus(500);
  }
});

// Function: enforce thread name via Graph API
async function enforceThreadName(threadId, name) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('No PAGE_ACCESS_TOKEN set. Cannot set thread name.');
    return;
  }
  try {
    // Workplace supports updating groups via: POST /{group-id} with name param (Workplace group API)
    // Or updating a thread via /{thread-id}?name=...
    // We'll attempt a generic update via Graph API. Adjust endpoint per your platform docs.
    const endpoint = `https://graph.facebook.com/v17.0/${threadId}`;
    console.log('Calling Graph API to set name:', name, 'on', endpoint);
    const resp = await axios.post(endpoint, null, {
      params: {
        access_token: PAGE_ACCESS_TOKEN,
        name: name
      }
    });
    console.log('Graph API response:', resp.data);
    return resp.data;
  } catch (err) {
    console.error('Failed to set thread name:', err.response ? err.response.data : err.message);
  }
}

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
