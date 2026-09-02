import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import {
  clamp,
  getMidpoint,
  getRegionFromPinch,
  pointDistance,
  toPixel,
  type Point,
  type Region,
} from './lib/geometry';
import { createShuffledBoard, isAdjacent, isSolved } from './lib/puzzle';
import type { AppState } from './types';
import './App.css';

const CLOSE_THRESHOLD = 0.13;
const OPEN_THRESHOLD = 0.19;
const CONFIRM_THRESHOLD = 0.25;
const CONFIRM_HOLD_MS = 400;
const HAND_LOSS_TIMEOUT_MS = 500;
const COUNTDOWN_SECONDS = 2;
const MEDIAPIPE_VERSION = '1.0.1';
const PUZZLE_PINCH_THRESHOLD = 0.15;
const PUZZLE_PICKUP_HOLD_MS = 100;
const RECORDS_KEY = 'cam-puzzle-records';

const DIFFICULTIES = {
  easy: { label: 'Easy', size: 3 },
  medium: { label: 'Medium', size: 4 },
  hard: { label: 'Hard', size: 5 },
} as const;

type Difficulty = keyof typeof DIFFICULTIES;
type RecordResult = { time: number; moves: number };

type PuzzleDrag = {
  tileValue: number;
  sourceIndex: number;
} | null;

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const appStateRef = useRef<AppState>('IDLE');
  const videoSizeRef = useRef({ width: 1280, height: 720 });
  const smoothedPinchRef = useRef<{ thumb: Point; index: Point } | null>(null);
  const confirmStartedAtRef = useRef<number | null>(null);
  const lastHandSeenAtRef = useRef(0);
  const puzzleDragRef = useRef<PuzzleDrag>(null);
  const puzzleBoardRef = useRef<number[]>([]);
  const puzzlePinchStartedAtRef = useRef<number | null>(null);
  const puzzleStartedAtRef = useRef<number | null>(null);
  const movesRef = useRef(0);
  const recordsRef = useRef<Partial<Record<Difficulty, RecordResult>>>({});
  const difficultyRef = useRef<Difficulty>('easy');
  const elapsedTenthsRef = useRef(0);
  const compactLayoutRef = useRef(false);
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 });
  const [landmarks, setLandmarks] = useState<Point[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [puzzleBoard, setPuzzleBoard] = useState<number[]>([]);
  const [puzzleCursor, setPuzzleCursor] = useState<Point | null>(null);
  const [puzzleDrag, setPuzzleDrag] = useState<PuzzleDrag>(null);
  const [puzzleTargetIndex, setPuzzleTargetIndex] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [moves, setMoves] = useState(0);
  const [elapsedTenths, setElapsedTenths] = useState(0);
  const [records, setRecords] = useState<Partial<Record<Difficulty, RecordResult>>>(() => {
    try {
      const stored = window.localStorage.getItem(RECORDS_KEY);
      return stored ? (JSON.parse(stored) as Partial<Record<Difficulty, RecordResult>>) : {};
    } catch {
      return {};
    }
  });
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isCompactLayout, setIsCompactLayout] = useState(() => window.innerWidth <= 680);

  useEffect(() => {
    puzzleBoardRef.current = puzzleBoard;
  }, [puzzleBoard]);

  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  useEffect(() => {
    elapsedTenthsRef.current = elapsedTenths;
  }, [elapsedTenths]);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 680px)');
    const updateLayout = () => {
      compactLayoutRef.current = mediaQuery.matches;
      setIsCompactLayout(mediaQuery.matches);
    };

    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  const updateState = (nextState: AppState) => {
    appStateRef.current = nextState;
    setAppState(nextState);
  };

  const setVideoDimensions = (width: number, height: number) => {
    const dimensions = { width, height };
    videoSizeRef.current = dimensions;
    setVideoSize(dimensions);
  };

  const resetSelection = (nextState: AppState = 'TRACKING') => {
    confirmStartedAtRef.current = null;
    setSelectedRegion(null);
    setCountdown(0);
    updateState(nextState);
  };

  const gridSize = DIFFICULTIES[difficulty].size;

  const formatTime = (tenths: number) => {
    const seconds = Math.floor(tenths / 10);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
  };

  const startPuzzle = (nextDifficulty = difficulty) => {
    const size = DIFFICULTIES[nextDifficulty].size;
    setDifficulty(nextDifficulty);
    const board = createShuffledBoard(size);
    puzzleBoardRef.current = board;
    setPuzzleBoard(board);
    movesRef.current = 0;
    setMoves(0);
    setElapsedTenths(0);
    setIsNewRecord(false);
    puzzleDragRef.current = null;
    setPuzzleDrag(null);
    puzzleStartedAtRef.current = performance.now();
    updateState('PUZZLE');
  };

  const completePuzzle = useCallback(() => {
    const startedAt = puzzleStartedAtRef.current;
    const finalTime =
      startedAt === null ? elapsedTenthsRef.current : Math.round((performance.now() - startedAt) / 100);
    const result = { time: finalTime, moves: movesRef.current };
    const currentDifficulty = difficultyRef.current;
    const currentRecord = recordsRef.current[currentDifficulty];
    const hasNewRecord =
      currentRecord === undefined ||
      result.time < currentRecord.time ||
      (result.time === currentRecord.time && result.moves < currentRecord.moves);

    setElapsedTenths(finalTime);
    setIsNewRecord(hasNewRecord);
    puzzleStartedAtRef.current = null;
    if (hasNewRecord) {
      const nextRecords = { ...recordsRef.current, [currentDifficulty]: result };
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
      window.localStorage.setItem(RECORDS_KEY, JSON.stringify(nextRecords));
    }
    updateState('PUZZLE_COMPLETED');
  }, []);

  const swapPuzzleTiles = useCallback((sourceIndex: number, destinationIndex: number) => {
    const currentBoard = puzzleBoardRef.current;
    if (
      sourceIndex === destinationIndex ||
      currentBoard[sourceIndex] === 0 ||
      currentBoard[destinationIndex] === 0
    ) {
      return;
    }

    const nextBoard = [...currentBoard];
    [nextBoard[sourceIndex], nextBoard[destinationIndex]] = [
      nextBoard[destinationIndex],
      nextBoard[sourceIndex],
    ];
    puzzleBoardRef.current = nextBoard;
    setPuzzleBoard(nextBoard);
    movesRef.current += 1;
    setMoves(movesRef.current);
    if (isSolved(nextBoard)) {
      completePuzzle();
    }
  }, [completePuzzle]);

  useEffect(() => {
    if (appState !== 'PUZZLE' || puzzleStartedAtRef.current === null) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const startedAt = puzzleStartedAtRef.current;
      if (startedAt !== null) {
        setElapsedTenths(Math.floor((performance.now() - startedAt) / 100));
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [appState]);

  useEffect(() => {
    if (appState !== 'COUNTDOWN') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setCountdown((currentCountdown) => {
        if (currentCountdown <= 1) {
          window.clearInterval(interval);
          updateState('CAPTURING');
          return 0;
        }

        return currentCountdown - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [appState]);

  useEffect(() => {
    if (appState !== 'CAPTURING' || selectedRegion === null) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      const video = videoRef.current;
      const context = document.createElement('canvas').getContext('2d');

      if (!video || !context || video.videoWidth === 0 || video.videoHeight === 0) {
        setCameraError('The video stream was not ready for capture. Please try again.');
        updateState('ERROR');
        return;
      }

      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      const side = Math.min(selectedRegion.width, selectedRegion.height);
      const cropWidth = clamp(side, 80, sourceWidth);
      const cropHeight = clamp(side, 80, sourceHeight);
      const cropX = clamp(
        facingMode === 'user' ? sourceWidth - selectedRegion.x - cropWidth : selectedRegion.x,
        0,
        sourceWidth - cropWidth,
      );
      const cropY = clamp(selectedRegion.y, 0, sourceHeight - cropHeight);
      const canvas = context.canvas;

      canvas.width = 720;
      canvas.height = 720;
      context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

      setCapturedImage(canvas.toDataURL('image/png'));
      startPuzzle();
    }, 100);

    return () => window.clearTimeout(timeout);
  }, [appState, facingMode, selectedRegion]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;
    let animationFrame: number | null = null;
    let lastVideoTime = -1;
    let lastOverlayUpdate = 0;

    const stopResources = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      landmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
    };

    const startupErrorMessage = (error: unknown) => {
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
          return 'Camera permission was denied or blocked. Allow camera access in your browser settings, then retry.';
        }
        if (error.name === 'NotFoundError') {
          return 'No camera was found on this device.';
        }
        if (error.name === 'NotReadableError') {
          return 'The camera is being used by another application. Close it and retry.';
        }
      }

      return error instanceof Error
        ? `Hand tracking could not start: ${error.message}`
        : 'Hand tracking could not start. Please retry.';
    };

    const smoothPoint = (previous: Point, next: Point): Point => ({
      x: previous.x + (next.x - previous.x) * 0.35,
      y: previous.y + (next.y - previous.y) * 0.35,
    });

    async function createLandmarker(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
      const baseOptions = {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      };

      try {
        return await HandLandmarker.createFromOptions(vision, {
          baseOptions: { ...baseOptions, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.35,
          minHandPresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
        });
      } catch {
        return HandLandmarker.createFromOptions(vision, {
          baseOptions: { ...baseOptions, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.35,
          minHandPresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
        });
      }
    }

    async function bootCamera() {
      try {
        setCameraError(null);
        updateState('IDLE');

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access requires a secure browser context (HTTPS or localhost).');
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });

        if (cancelled || !videoRef.current) {
          stopResources();
          return;
        }

        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        if (cancelled) {
          stopResources();
          return;
        }

        setVideoDimensions(video.videoWidth, video.videoHeight);
        const vision = await FilesetResolver.forVisionTasks(
          `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
        );
        landmarker = await createLandmarker(vision);

        if (cancelled) {
          stopResources();
          return;
        }

        updateState('CAMERA_READY');

        const processFrame = () => {
          if (cancelled || !landmarker) {
            return;
          }

          const activeVideo = videoRef.current;
          if (activeVideo && activeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            if (activeVideo.currentTime !== lastVideoTime) {
              lastVideoTime = activeVideo.currentTime;
              const results = landmarker.detectForVideo(activeVideo, performance.now());
              const detected = results.landmarks[0];
              const now = performance.now();

              if (detected) {
                lastHandSeenAtRef.current = now;
                // Only the front-camera preview is mirrored.
                const rawLandmarks = detected.map(({ x, y }) => ({
                  x: facingMode === 'user' ? 1 - x : x,
                  y,
                }));
                const rawThumb = rawLandmarks[4];
                const rawIndex = rawLandmarks[8];

                if (rawThumb && rawIndex) {
                  const previous = smoothedPinchRef.current;
                  const thumb = previous ? smoothPoint(previous.thumb, rawThumb) : rawThumb;
                  const index = previous ? smoothPoint(previous.index, rawIndex) : rawIndex;
                  smoothedPinchRef.current = { thumb, index };

                  if (now - lastOverlayUpdate > 50) {
                    setLandmarks(rawLandmarks);
                    lastOverlayUpdate = now;
                  }

                  const distance = pointDistance(thumb, index);
                  const center = getMidpoint(thumb, index);
                  const { width, height } = videoSizeRef.current;
                  const region = getRegionFromPinch(toPixel(center, width, height), distance, width, height);
                  const currentState = appStateRef.current;

                  if (currentState === 'PUZZLE' || currentState === 'PUZZLE_COMPLETED') {
                    const cursor = index;
                    const isPinching = distance < PUZZLE_PINCH_THRESHOLD;
                    const { width, height } = videoSizeRef.current;
                    const puzzleWidth = compactLayoutRef.current ? 0.62 : 0.36;
                    const puzzleHeight = puzzleWidth * (width / height);
                    const puzzleBounds = {
                      x: (1 - puzzleWidth) / 2,
                      y: (1 - puzzleHeight) / 2,
                      width: puzzleWidth,
                      height: puzzleHeight,
                    };
                    const isOverPuzzle =
                      cursor.x >= puzzleBounds.x &&
                      cursor.x <= puzzleBounds.x + puzzleBounds.width &&
                      cursor.y >= puzzleBounds.y &&
                      cursor.y <= puzzleBounds.y + puzzleBounds.height;
                    const tileColumn = isOverPuzzle
                      ? clamp(
                          Math.floor(((cursor.x - puzzleBounds.x) / puzzleBounds.width) * gridSize),
                          0,
                          gridSize - 1,
                        )
                      : -1;
                    const tileRow = isOverPuzzle
                      ? clamp(
                          Math.floor(((cursor.y - puzzleBounds.y) / puzzleBounds.height) * gridSize),
                          0,
                          gridSize - 1,
                        )
                      : -1;
                    const tileIndex = isOverPuzzle ? tileRow * gridSize + tileColumn : -1;

                    if (now - lastOverlayUpdate > 50) {
                      setPuzzleCursor(cursor);
                      setPuzzleTargetIndex(tileIndex >= 0 ? tileIndex : null);
                    }

                    if (currentState === 'PUZZLE') {
                      const currentBoard = puzzleBoardRef.current;
                      if (isPinching && puzzleDragRef.current === null && tileIndex >= 0) {
                        if (puzzlePinchStartedAtRef.current === null) {
                          puzzlePinchStartedAtRef.current = now;
                        }
                      } else if (!isPinching) {
                        puzzlePinchStartedAtRef.current = null;
                      }

                      if (
                        isPinching &&
                        puzzleDragRef.current === null &&
                        tileIndex >= 0 &&
                        currentBoard[tileIndex] !== 0 &&
                        puzzlePinchStartedAtRef.current !== null &&
                        now - puzzlePinchStartedAtRef.current >= PUZZLE_PICKUP_HOLD_MS
                      ) {
                        const nextDrag = { tileValue: currentBoard[tileIndex], sourceIndex: tileIndex };
                        puzzleDragRef.current = nextDrag;
                        setPuzzleDrag(nextDrag);
                      } else if (!isPinching && puzzleDragRef.current !== null) {
                        const drag = puzzleDragRef.current;
                        puzzleDragRef.current = null;
                        puzzlePinchStartedAtRef.current = null;
                        setPuzzleDrag(null);
                        if (tileIndex >= 0) {
                          swapPuzzleTiles(drag.sourceIndex, tileIndex);
                        }
                      }
                    }

                    animationFrame = window.requestAnimationFrame(processFrame);
                    return;
                  }

                  if (currentState === 'IDLE' || currentState === 'CAMERA_READY') {
                    updateState('TRACKING');
                  }

                  if (currentState === 'TRACKING' && distance < CLOSE_THRESHOLD) {
                    updateState('PINCH_DETECTED');
                  } else if (currentState === 'PINCH_DETECTED' && distance > OPEN_THRESHOLD) {
                    setSelectedRegion(region);
                    updateState('SELECTING_REGION');
                  } else if (currentState === 'SELECTING_REGION') {
                    if (distance < CLOSE_THRESHOLD) {
                      resetSelection('PINCH_DETECTED');
                    } else {
                      setSelectedRegion(region);
                      if (distance > CONFIRM_THRESHOLD) {
                        if (confirmStartedAtRef.current === null) {
                          confirmStartedAtRef.current = now;
                        } else if (now - confirmStartedAtRef.current >= CONFIRM_HOLD_MS) {
                          confirmStartedAtRef.current = null;
                          setCountdown(COUNTDOWN_SECONDS);
                          updateState('COUNTDOWN');
                        }
                      } else {
                        confirmStartedAtRef.current = null;
                      }
                    }
                  } else if (currentState === 'COUNTDOWN' && distance < CLOSE_THRESHOLD) {
                    resetSelection();
                  }
                }
              } else if (now - lastHandSeenAtRef.current > HAND_LOSS_TIMEOUT_MS) {
                smoothedPinchRef.current = null;
                setLandmarks([]);
                setPuzzleCursor(null);
                puzzleDragRef.current = null;
                puzzlePinchStartedAtRef.current = null;
                setPuzzleDrag(null);
                setPuzzleTargetIndex(null);
                const currentState = appStateRef.current;
                if (
                  currentState === 'PINCH_DETECTED' ||
                  currentState === 'SELECTING_REGION' ||
                  currentState === 'COUNTDOWN'
                ) {
                  resetSelection();
                }
              }
            }
          }

          animationFrame = window.requestAnimationFrame(processFrame);
        };

        animationFrame = window.requestAnimationFrame(processFrame);
      } catch (error) {
        if (!cancelled) {
          setCameraError(startupErrorMessage(error));
          updateState('ERROR');
        }
      }
    }

    void bootCamera();

    return () => {
      cancelled = true;
      stopResources();
    };
  }, [facingMode, gridSize, startupAttempt, swapPuzzleTiles]);

  const moveTile = (index: number) => {
    if (appState !== 'PUZZLE') {
      return;
    }

    const emptyIndex = puzzleBoard.indexOf(0);
    if (emptyIndex === -1 || !isAdjacent(index, emptyIndex, gridSize)) {
      return;
    }

    const nextBoard = [...puzzleBoard];
    [nextBoard[index], nextBoard[emptyIndex]] = [nextBoard[emptyIndex], nextBoard[index]];
    puzzleBoardRef.current = nextBoard;
    setPuzzleBoard(nextBoard);
    movesRef.current += 1;
    setMoves(movesRef.current);
    if (isSolved(nextBoard)) {
      completePuzzle();
    }
  };

  const statusText: Record<AppState, string> = {
    IDLE: 'Starting camera and hand tracking...',
    CAMERA_READY: 'Camera ready. Hold your hand in frame.',
    TRACKING: 'Show a closed thumb-and-index pinch.',
    PINCH_DETECTED: 'Now open your thumb and index finger.',
    SELECTING_REGION: 'Position the square, then hold your fingers open.',
    COUNTDOWN: 'Hold still. Close your fingers to cancel.',
    CAPTURING: 'Capturing your image...',
    PUZZLE: 'Tap tiles beside the empty space to solve it.',
    PUZZLE_COMPLETED: 'Puzzle solved! Ready for a new capture.',
    ERROR: cameraError ?? 'Camera or hand tracking could not start.',
  };

  const tileStyles = (tileValue: number) => {
    const tileIndex = tileValue - 1;
    const row = Math.floor(tileIndex / gridSize);
    const column = tileIndex % gridSize;

    return {
      backgroundImage: capturedImage ? `url("${capturedImage}")` : 'none',
      backgroundSize: `${gridSize * 100}% ${gridSize * 100}%`,
      backgroundPosition: `${(column / (gridSize - 1)) * 100}% ${(row / (gridSize - 1)) * 100}%`,
    };
  };

  const regionStyle = selectedRegion
    ? {
        left: `${(selectedRegion.x / videoSize.width) * 100}%`,
        top: `${(selectedRegion.y / videoSize.height) * 100}%`,
        width: `${(selectedRegion.width / videoSize.width) * 100}%`,
        height: `${(selectedRegion.height / videoSize.height) * 100}%`,
      }
    : undefined;

  const puzzleCursorStyle = puzzleCursor
    ? { left: `${puzzleCursor.x * 100}%`, top: `${puzzleCursor.y * 100}%` }
    : undefined;

  const puzzleWidth = isCompactLayout ? 0.62 : 0.36;
  const puzzleHeight = puzzleWidth * (videoSize.width / videoSize.height);
  const puzzleBoardStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
    left: `${((1 - puzzleWidth) / 2) * 100}%`,
    top: `${((1 - puzzleHeight) / 2) * 100}%`,
    width: `${puzzleWidth * 100}%`,
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Camera game</p>
          <h1>CAM PUZZLE</h1>
        </div>
        <div className="badge" role="status">{statusText[appState]}</div>
      </header>

      <main className="workspace">
        <section className="camera-panel">
            <div
              className="camera-stage"
              style={{ aspectRatio: `${videoSize.width} / ${videoSize.height}` }}
            >
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={facingMode === 'user' ? 'mirrored' : undefined}
              />
              <div className="camera-overlay">
                {selectedRegion && <div className="selection-box" style={regionStyle} />}
                {countdown > 0 && appState === 'COUNTDOWN' && (
                  <div className="countdown-ring"><span>{countdown}</span></div>
                )}
                {landmarks.map((point, index) => (
                  <span
                    key={`landmark-${index}`}
                    className="landmark-dot"
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  />
                ))}
                {puzzleCursor && (
                  <span
                    className={`puzzle-cursor${puzzleDrag ? ' grabbing' : ''}`}
                    style={puzzleCursorStyle}
                  />
                )}
                {(appState === 'PUZZLE' || appState === 'PUZZLE_COMPLETED') && capturedImage && (
                  <div className="puzzle-layer">
                    <div className="game-hud" aria-label="Game statistics">
                      <div><span>Time</span><strong>{formatTime(elapsedTenths)}</strong></div>
                      <div><span>Moves</span><strong>{moves}</strong></div>
                      <div><span>Best</span><strong>{records[difficulty] ? formatTime(records[difficulty].time) : '--:--.-'}</strong></div>
                    </div>
                    <div
                      className="puzzle-board"
                      style={puzzleBoardStyle}
                    >
                      {puzzleBoard.map((tileValue, index) =>
                        tileValue === 0 ? (
                          <div key={`empty-${index}`} className="tile empty" aria-label="Empty tile" />
                        ) : (
                          <button
                            key={`tile-${tileValue}-${index}`}
                            type="button"
                            className={`tile${puzzleDrag?.sourceIndex === index ? ' grabbed' : ''}${puzzleTargetIndex === index ? ' targeted' : ''}`}
                            style={tileStyles(tileValue)}
                            onClick={() => moveTile(index)}
                            aria-label={`Move tile ${tileValue}`}
                          />
                        ),
                      )}
                    </div>
                    <div className="puzzle-controls">
                      <p>{appState === 'PUZZLE_COMPLETED' ? 'Puzzle solved!' : 'Tap an adjacent tile or pinch, move, and release.'}</p>
                      <div className="difficulty-picker" aria-label="Puzzle difficulty">
                        {(Object.keys(DIFFICULTIES) as Difficulty[]).map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={difficulty === level ? 'difficulty active' : 'difficulty'}
                            onClick={() => startPuzzle(level)}
                            aria-pressed={difficulty === level}
                          >
                            {DIFFICULTIES[level].label}
                          </button>
                        ))}
                      </div>
                      <button type="button" className="secondary-button" onClick={() => startPuzzle()}>
                        Restart
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => {
                          puzzleDragRef.current = null;
                          setPuzzleDrag(null);
                          setPuzzleCursor(null);
                          setCapturedImage(null);
                          setPuzzleBoard([]);
                          resetSelection('CAMERA_READY');
                        }}
                      >
                        New capture
                      </button>
                    </div>
                    {appState === 'PUZZLE_COMPLETED' && (
                      <div className="victory-modal" role="dialog" aria-modal="true" aria-labelledby="victory-title">
                        <p className="victory-icon" aria-hidden="true">★</p>
                        <p className="eyebrow">Puzzle complete</p>
                        <h2 id="victory-title">{isNewRecord ? 'New personal best!' : 'Great work!'}</h2>
                        <div className="victory-results">
                          <span>{formatTime(elapsedTenths)}<small>Time</small></span>
                          <span>{moves}<small>Moves</small></span>
                        </div>
                        <button type="button" className="primary-button" onClick={() => startPuzzle()}>
                          Play again
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {appState === 'ERROR' ? (
              <div className="message-box error">
                <p>{cameraError}</p>
                <button type="button" className="primary-button" onClick={() => setStartupAttempt((value) => value + 1)}>
                  Retry camera and tracking
                </button>
              </div>
            ) : (
              <div className="hint-box">
                <p>Pinch thumb and index together, open them to size the square, then hold open to capture.</p>
                <button
                  type="button"
                  className="camera-switch"
                  onClick={() => setFacingMode((current) => (current === 'user' ? 'environment' : 'user'))}
                >
                  Use {facingMode === 'user' ? 'rear' : 'front'} camera
                </button>
              </div>
            )}
          </section>
      </main>
    </div>
  );
}

export default App;
