import rtms from "@zoom/rtms";

// Listen for transcript data
rtms.onTranscriptData((data, size, timestamp, metadata) => {
  console.log(`${metadata.userName}: ${data}`);
  console.log(`Bytes Size: ${size}`);
  console.log(`Sent at: ${timestamp}`);
});

// Handle webhook events
rtms.onWebhookEvent(({ payload }) => {
  rtms.join(payload);
});
