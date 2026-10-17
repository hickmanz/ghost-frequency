/**
 * Section-level automation: smooth per-layer gain entries/exits, slow filter drift following energy,
 * reverb/delay baselines and transition gestures (master filter dip/sweep + reverb swell).
 *
 * Targets used here: layer.gain.<layer>, filter.pad/arp/bass/lead, send.reverb, send.delay, master.filter.
 * (texture.noise / filter.texture come from layers/texture.ts.)
 * Semantics assumed: an event at `beat` ramps linearly from the previous value to `value`, reaching it at
 * beat + rampBeats (rampBeats 0 = jump). Events sharing a beat must be applied in array order.
 */
import type { AutomationEvent, AutomationTarget, LayerId } from '@shared/index';
import { LAYER_IDS } from '@shared/index';
import { BEATS_PER_BAR, energyAt, liveMood, type LayerContext } from './layers/context';
import { clamp } from './theory';

const ENTER_BARS: Record<LayerId, number> = { pad: 2, texture: 2, arp: 2, lead: 2, bass: 1, drums: 1, bell: 2 };
const EXIT_BARS: Record<LayerId, number> = { pad: 2, texture: 2, arp: 2, lead: 2, bass: 2, drums: 1, bell: 2 };

const gainTarget = (l: LayerId): AutomationTarget => `layer.gain.${l}` as AutomationTarget;

function ev(target: AutomationTarget, beat: number, value: number, rampBeats = 0): AutomationEvent {
  return { kind: 'automation', target, beat, value: clamp(value, 0, 1), rampBeats };
}

/** Slow deterministic drift in [-1, 1], different phase per key. */
function drift(bar: number, periodBars: number, phase: number): number {
  return Math.sin((2 * Math.PI * bar) / periodBars + phase);
}

const FILTER_BASE: Record<'pad' | 'arp' | 'bass' | 'lead', { base: number; span: number; phase: number; period: number }> = {
  pad: { base: 0.36, span: 0.38, phase: 0.4, period: 41 },
  arp: { base: 0.3, span: 0.5, phase: 1.9, period: 29 },
  bass: { base: 0.4, span: 0.32, phase: 3.3, period: 53 },
  lead: { base: 0.42, span: 0.42, phase: 5.1, period: 37 },
};

export function filterOpenness(layer: keyof typeof FILTER_BASE, energy: number, bar: number): number {
  const f = FILTER_BASE[layer];
  return clamp(f.base + f.span * energy + 0.06 * drift(bar, f.period, f.phase), 0.1, 0.98);
}

export function reverbLevel(base: number, energy: number, bar: number): number {
  return clamp(base + 0.04 * (1 - energy) + 0.035 * drift(bar, 47, 0.7), 0.15, 0.95);
}

export function delayLevel(base: number, energy: number, bar: number): number {
  return clamp(base + 0.03 * energy + 0.03 * drift(bar, 31, 2.2), 0.1, 0.95);
}

export function renderAutomation(ctx: LayerContext): AutomationEvent[] {
  const { plan, fromBar, toBar } = ctx;
  const out: AutomationEvent[] = [];
  const mood = liveMood(ctx);
  const first = plan.index === 0;

  for (let bar = fromBar; bar < toBar; bar++) {
    const rel = bar - plan.startBar;
    const beat = bar * BEATS_PER_BAR;
    const e = energyAt(ctx, bar);
    const atPieceStart = first && rel === 0;

    // ---- one-time initial state at the very start of the piece
    if (atPieceStart) {
      for (const l of LAYER_IDS) out.push(ev(gainTarget(l), beat, 0));
      out.push(ev('master.filter', beat, 1));
    }

    // ---- section start: transition release
    if (rel === 0 && !first) {
      const style = plan.entry ?? 'swell';
      const ramp = style === 'sweep' ? 2 : style === 'dip' ? 16 : 8;
      out.push(ev('master.filter', beat, 1, ramp));
    }

    // ---- per-layer gain: entries and exits
    for (const l of LAYER_IDS) {
      for (const [s, eEnd] of plan.layers[l]) {
        const end = Math.min(eEnd, plan.lengthBars);
        if (s === rel && s < plan.lengthBars && !(s === 0 && plan.joinsPrev[l])) {
          const bars = atPieceStart && (l === 'pad' || l === 'texture') ? 4 : ENTER_BARS[l];
          out.push(ev(gainTarget(l), beat, 1, bars * BEATS_PER_BAR));
        }
        if (end < plan.lengthBars) {
          // mid-section exit: fade over the last bars while notes are still playing
          const outBars = Math.min(EXIT_BARS[l], Math.max(1, end - s));
          if (rel === end - outBars) out.push(ev(gainTarget(l), beat, 0, outBars * BEATS_PER_BAR));
        } else if (plan.leavesAtEnd[l]) {
          if (l === 'drums') {
            if (rel === plan.lengthBars - 1) out.push(ev(gainTarget(l), beat, 0, 0.5));
          } else if (rel === plan.lengthBars - EXIT_BARS[l]) {
            out.push(ev(gainTarget(l), beat, 0, EXIT_BARS[l] * BEATS_PER_BAR));
          }
        }
      }
    }

    // ---- filters follow energy (every other bar, plus at section start)
    if (rel === 0 || bar % 2 === 0) {
      const ramp = atPieceStart ? 0 : 8;
      (['pad', 'arp', 'bass', 'lead'] as const).forEach((l) => {
        out.push(ev(`filter.${l}` as AutomationTarget, beat, filterOpenness(l, e, bar), ramp));
      });
    }

    // ---- reverb / delay baselines
    if (bar % 4 === 0) {
      let ramp = 7;
      if (atPieceStart) ramp = 0;
      else if (rel === 0) ramp = plan.entry === 'dip' ? 16 : 8;
      out.push(ev('send.reverb', beat, reverbLevel(mood.fx.reverb, e, bar), ramp));
      out.push(ev('send.delay', beat, delayLevel(mood.fx.delay, e, bar), ramp));
    }

    // ---- exit gesture two bars before the section ends
    if (rel === plan.lengthBars - 2) {
      const style = plan.exit ?? 'swell';
      const baseRev = reverbLevel(mood.fx.reverb, e, bar);
      if (style === 'sweep') {
        out.push(ev('master.filter', beat, 0.5, 8));
        out.push(ev('send.reverb', beat, baseRev + 0.2, 8));
      } else if (style === 'dip') {
        out.push(ev('master.filter', beat, 0.62, 8));
        out.push(ev('send.reverb', beat, baseRev + 0.15, 8));
      } else {
        out.push(ev('master.filter', beat, 0.85, 8));
        out.push(ev('send.reverb', beat, baseRev + 0.16, 8));
      }
    }
  }
  return out;
}
