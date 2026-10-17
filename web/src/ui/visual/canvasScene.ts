/** Contract between the shared canvas host (VisualCanvas) and an individual visual mode. */
export interface SceneInstance {
  /** CSS-pixel size + device pixel ratio changed (canvas bitmap already resized). Rebuild size-dependent caches. */
  resize(w: number, h: number, dpr: number): void;
  /**
   * Draw one frame. `now` is accumulated animation time in ms (frozen under reduced-motion),
   * `dt` the ms since the previous drawn frame (0 for a repaint-after-resize).
   */
  frame(now: number, dt: number, playing: boolean): void;
  dispose?(): void;
}

export type SceneFactory = (ctx: CanvasRenderingContext2D) => SceneInstance;

export interface SceneOptions {
  fpsActive: number;
  fpsIdle: number;
}
