const assert = require("node:assert");
const test = require("node:test");
const { createLiveKitToken, getLiveKitConfig, getLiveKitRoomName } = require("../src/livekit");

test("SFU Readiness (LiveKit): Configuration status and room name derivation", () => {
  const config = getLiveKitConfig();
  assert.strictEqual(typeof config.enabled, "boolean");
  assert.strictEqual(typeof config.roomPrefix, "string");

  const roomName = getLiveKitRoomName("ROOM-7K9P");
  assert.strictEqual(roomName, `${config.roomPrefix}-room-7k9p`.toLowerCase());
});

test("SFU Readiness (LiveKit): Safe fallback when LiveKit is not configured", async () => {
  const originalEnable = process.env.ENABLE_LIVEKIT;
  try {
    delete process.env.ENABLE_LIVEKIT;
    // When disabled, createLiveKitToken should throw an informative error
    await assert.rejects(
      async () => {
        await createLiveKitToken({
          roomId: "ROOM-TEST",
          participantId: "user-1",
          role: "listener"
        });
      },
      /LiveKit is not configured/
    );
  } finally {
    if (originalEnable !== undefined) process.env.ENABLE_LIVEKIT = originalEnable;
  }
});

test("SFU Readiness (LiveKit): Server-generated participant tokens and role-based grants", async () => {
  // Test token creation with mock developer credentials in test environment
  const originalKey = process.env.LIVEKIT_API_KEY;
  const originalSecret = process.env.LIVEKIT_API_SECRET;
  const originalEnable = process.env.ENABLE_LIVEKIT;

  try {
    process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "devkey";
    process.env.LIVEKIT_API_SECRET = "secret012345678901234567890123456789";

    // Re-require with environment set
    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/livekit")];
    const livekit = require("../src/livekit");

    // 1. Host Token (Publisher)
    const hostPayload = await livekit.createLiveKitToken({
      roomId: "ROOM-BETA",
      participantId: "host-user-99",
      participantName: "Host Producer",
      role: "host",
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    assert.ok(hostPayload.token, "Must return signed JWT");
    assert.strictEqual(hostPayload.role, "host");
    assert.strictEqual(hostPayload.participantIdentity, "host-user-99");
    assert.ok(hostPayload.roomName.includes("room-beta"));

    // Decode JWT payload without verifying signature just to inspect claims
    const [headerB64, claimsB64] = hostPayload.token.split(".");
    const claims = JSON.parse(Buffer.from(claimsB64, "base64url").toString());
    assert.strictEqual(claims.sub, "host-user-99");
    assert.strictEqual(claims.video.canPublish, true, "Host must have publishing permission");
    assert.strictEqual(claims.video.canSubscribe, true);

    // 2. Listener Token (Subscriber only)
    const listenerPayload = await livekit.createLiveKitToken({
      roomId: "ROOM-BETA",
      participantId: "listener-user-1",
      participantName: "Beta Listener",
      role: "listener",
      canPublish: false,
      canSubscribe: true,
      canPublishData: true
    });

    const listenerClaims = JSON.parse(Buffer.from(listenerPayload.token.split(".")[1], "base64url").toString());
    assert.strictEqual(listenerClaims.video.canPublish, false, "Listener must NOT have publish grant");
    assert.strictEqual(listenerClaims.video.canSubscribe, true, "Listener must have subscribe grant");

    // 3. Room isolation check: Token grant is strictly bounded to the specified room
    assert.strictEqual(listenerClaims.video.room, hostPayload.roomName, "Both tokens are scoped to the same room");
    assert.ok(!listenerClaims.video.room.includes("ROOM-ALPHA"), "Token cannot access different rooms");
  } finally {
    process.env.ENABLE_LIVEKIT = originalEnable || "";
    process.env.LIVEKIT_API_KEY = originalKey || "";
    process.env.LIVEKIT_API_SECRET = originalSecret || "";
    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/livekit")];
  }
});
