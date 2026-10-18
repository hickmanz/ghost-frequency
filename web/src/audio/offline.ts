import * as Tone from 'tone';
import type { EventBatch, MixerParams, MoodId } from '@shared/index';
import { AudioGraph } from './graph';
import { TempoMap, clampBpm, secondsPerBeat } from './mapping';
import { Scheduler, TEMPO_RAMP_BEATS, type SchedulerHost } from './scheduler';
import { splitDrumKit } from './presets';

export { audioBufferToWav } from './wav';

/** Extra seconds rendered after the last bar so reverb/delay/release tails are not cut. */
export const OFFLINE_TAIL_SECONDS = 5;

/**
 * Render `bars` bars (4/4) of the given batches through the SAME graph used for realtime playback, inside a
 * Tone.Offline context. Best effort: it depends on Tone.Offline being able to run the transport.
 *
 * `tempo` is the initial tempo; batches carry their own tempo (ramped exactly like in realtime).
 * The returned buffer is stereo, includes a reverb/delay tail of OFFLINE_TAIL_SECONDS after the last bar.
 */
export async function renderOffline(
  batches: EventBatch[],
  bars: number,
  tempo: number,
  mood: MoodId,
  mixer: MixerParams,
): Promise<AudioBuffer> {
  const ordered = [...batches].sort((a, b) => a.startBeat - b.startBeat);
  const totalBeats = Math.max(1, bars) * 4;
  const bpm0 = clampBpm(tempo);

  // duration estimate from the tempo map (mirrors the scheduler's tempo ramps)
  const tm = new TempoMap(bpm0);
  let lastBpm = bpm0;
  for (const b of ordered) {
    const bpm = clampBpm(b.tempo);
    if (Math.abs(bpm - lastBpm) > 0.01 && b.startBeat > 0 && b.startBeat < totalBeats) {
      tm.addChange(b.startBeat, bpm, TEMPO_RAMP_BEATS * secondsPerBeat(bpm));
      lastBpm = bpm;
    }
  }
  const duration = tm.beatToSeconds(totalBeats) + OFFLINE_TAIL_SECONDS;

  const rendered = await Tone.Offline((ctx) => {
    // everything below runs synchronously against the offline context (global context is swapped by Tone.Offline)
    const graph = new AudioGraph({ mood, mixer, analysis: false });
    const host: SchedulerHost = {
      onNote: (ev, time, dur) => graph.trigger(ev.layer, ev.midi, dur, time, ev.vel),
      onAutomation: (ev, time, ramp) => graph.automate(ev.target, ev.value, time, ramp),
      onTempo: (bpm, time, ramp) => graph.setTempo(bpm, time, ramp),
      onPalette: (ev) => {
        const { kit, tune } = splitDrumKit(ev.overrides);
        if (kit !== undefined) graph.setDrumKit(kit, tune);
      },
    };
    const transport = ctx.transport;
    transport.bpm.value = bpm0;
    const scheduler = new Scheduler(transport, host, ctx);
    // the first batch's tempo is applied directly; make sure a tempo-less start uses `tempo`
    scheduler.schedule({ version: 1, startBeat: 0, endBeat: 0, tempo: bpm0, timeSig: [4, 4], events: [] });
    for (const b of ordered) {
      if (b.startBeat >= totalBeats) continue;
      scheduler.schedule({ ...b, events: b.events.filter((e) => e.beat < totalBeats) });
    }
    scheduler.play(0);
  }, duration, 2);

  return rendered.get() as AudioBuffer;
}
