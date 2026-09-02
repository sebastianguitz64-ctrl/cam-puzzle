export type AppState =
  | 'IDLE'
  | 'CAMERA_READY'
  | 'TRACKING'
  | 'PINCH_DETECTED'
  | 'SELECTING_REGION'
  | 'COUNTDOWN'
  | 'CAPTURING'
  | 'PUZZLE'
  | 'PUZZLE_COMPLETED'
  | 'ERROR';

export type HandPoint = {
  x: number;
  y: number;
};
