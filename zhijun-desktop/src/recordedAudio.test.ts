import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { recordedBlobToWav } from "../../dashboard/src/utils/recordedAudio";

const require = createRequire(import.meta.url);
const { validateAudio } = require("../shell/native-speech.cjs") as {
  validateAudio: (audio: Uint8Array) => Buffer;
};

function audioContext(samples: Float32Array) {
  const close = vi.fn().mockResolvedValue(undefined);
  class Decoder {
    decodeAudioData = vi
      .fn()
      .mockResolvedValue({ duration: samples.length / 16000 });
    close = close;
  }
  class Renderer {
    destination = {};
    constructor(
      private channels: number,
      private length: number,
      private sampleRate: number,
    ) {}
    createBufferSource() {
      return { buffer: null, connect: vi.fn(), start: vi.fn() };
    }
    async startRendering() {
      expect(this.channels).toBe(1);
      expect(this.sampleRate).toBe(16000);
      return { getChannelData: () => samples.slice(0, this.length) };
    }
  }
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("AudioContext", Decoder);
  vi.stubGlobal("OfflineAudioContext", Renderer);
  return close;
}
afterEach(() => vi.unstubAllGlobals());

it("a timer-delayed 60.052-second clip becomes valid bounded PCM with correct RIFF length and final sample", async () => {
  const samples = new Float32Array(960832).fill(0.25);
  samples[959999] = 0.5;
  samples.fill(-0.5, 960000);
  const close = audioContext(samples);
  const recorded = new Blob(["synthetic audio container"], {
    type: "audio/webm",
  });
  const wav = await recordedBlobToWav(recorded, 60);
  const bytes = Buffer.from(await wav.arrayBuffer());
  expect(wav.type).toBe("audio/wav");
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
  expect(bytes.readUInt16LE(20)).toBe(1);
  expect(bytes.readUInt16LE(22)).toBe(1);
  expect(bytes.readUInt32LE(24)).toBe(16000);
  expect(bytes.readUInt16LE(34)).toBe(16);
  expect(bytes.readUInt32LE(40)).toBe(960000 * 2);
  expect(bytes.length).toBe(44 + 960000 * 2);
  expect(bytes.readInt16LE(bytes.length - 2)).toBe(16383);
  expect(validateAudio(new Uint8Array(bytes)).equals(bytes)).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
});

it("short recordings keep their full final sample, and existing WANX calls retain unrestricted duration", async () => {
  const short = new Float32Array(16000);
  short[15999] = -0.5;
  audioContext(short);
  const recorded = new Blob(["synthetic audio container"], {
    type: "audio/webm",
  });
  const bounded = Buffer.from(
    await (await recordedBlobToWav(recorded, 60)).arrayBuffer(),
  );
  expect(bounded.length).toBe(44 + 16000 * 2);
  expect(bounded.readInt16LE(bounded.length - 2)).toBe(-16384);
  expect(validateAudio(new Uint8Array(bounded)).equals(bounded)).toBe(true);

  audioContext(new Float32Array(960832).fill(0.25));
  const nativeWanx = Buffer.from(
    await (await recordedBlobToWav(recorded)).arrayBuffer(),
  );
  expect(nativeWanx.readUInt32LE(40)).toBe(960832 * 2);
  let error: unknown;
  try {
    validateAudio(new Uint8Array(nativeWanx));
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ code: "AUDIO_TOO_LONG" });
});
