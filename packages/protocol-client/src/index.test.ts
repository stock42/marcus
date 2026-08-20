import { expect, test } from "bun:test";
import { MNP_PREFACE, MNP_PREFACE_OK, MnpFrameCodec, MnpFrameDecoder, type MnpRequest } from "@marcus/protocol";
import { MnpClient } from "./index";

type TestConnection = { stage: "preface" | "frames"; bytes: Uint8Array; decoder: MnpFrameDecoder };

test("connects, authenticates, multiplexes a request, and reports request timeout", async () => {
  const codec = new MnpFrameCodec();
  const listener = Bun.listen<TestConnection>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) { socket.data = { stage: "preface", bytes: new Uint8Array(), decoder: new MnpFrameDecoder() }; },
      data(socket, chunk) {
        let data: Uint8Array = chunk;
        if (socket.data.stage === "preface") {
          const combined = new Uint8Array(socket.data.bytes.length + chunk.length);
          combined.set(socket.data.bytes);
          combined.set(chunk, socket.data.bytes.length);
          const expected = new TextEncoder().encode(MNP_PREFACE);
          if (combined.length < expected.length) { socket.data.bytes = combined; return; }
          expect(new TextDecoder().decode(combined.slice(0, expected.length))).toBe(MNP_PREFACE);
          socket.data.stage = "frames";
          socket.write(new TextEncoder().encode(MNP_PREFACE_OK));
          data = combined.slice(expected.length);
        }
        for (const frame of socket.data.decoder.push(data)) {
          if (frame.type === "HELLO") socket.write(codec.encodeJson("HELLO", { protocolVersion: 1, productVersion: "test", name: "test-server", capabilities: [] }));
          if (frame.type === "AUTH") socket.write(codec.encodeJson("AUTH_OK", { sessionId: "session-test", principal: { id: "user-test", type: "user" }, permissions: ["*"] }));
          if (frame.type === "REQUEST") {
            const request = codec.decodeJson<MnpRequest>(frame);
            if (request.operation !== "ignored") socket.write(codec.encodeJson("RESPONSE", { requestId: request.requestId, ok: true, data: request.payload, serverTime: new Date().toISOString() }));
          }
        }
      },
    },
  });
  const client = new MnpClient({ hostname: "127.0.0.1", port: listener.port, authentication: { method: "bootstrap-token", token: "test" } });
  try {
    expect(await client.connect()).toMatchObject({ sessionId: "session-test", principal: { id: "user-test" } });
    expect(await client.request<{ value: number }, { value: number }>("echo", { value: 42 })).toEqual({ value: 42 });
    await expect(client.request("ignored", {}, { timeoutMs: 5 })).rejects.toMatchObject({ code: "MNP_REQUEST_TIMEOUT" });
  } finally {
    client.close();
    listener.stop(true);
  }
});
