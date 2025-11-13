// ====== 기본 상수 ======
const BOARD_SIZE = 8;
const TILE_TYPES = 5;
const MAX_MOVES = 30;

// ms 단위 애니메이션 시간
const SWAP_DURATION = 220;
const CLEAR_DURATION = 420;
const FALL_DURATION = 520;

// 음식 이모지
const EMOJIS = ["🍎", "🍕", "🍣", "🍔", "🍰"];

// DOM 요소
const canvas = document.getElementById("boardCanvas");
const ctx = canvas.getContext("2d");

const scoreText = document.getElementById("scoreText");
const movesText = document.getElementById("movesText");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayScore = document.getElementById("overlayScore");
const resetBtn = document.getElementById("resetBtn");
const restartBtn = document.getElementById("restartBtn");

// 타일 크기 (캔버스 width 기준)
const TILE_SIZE = canvas.width / BOARD_SIZE;
const TILE_MARGIN = 6;

// ====== 게임 상태 ======
let board = []; // 8x8, 값: 0..TILE_TYPES-1 또는 null
let selected = null; // { row, col } | null
let score = 0;
let moves = MAX_MOVES;

// 현재 진행 중인 애니메이션 하나만 유지
// type: 'swap' | 'clear' | 'fall' | null
let currentAnimation = null;
// 한 번의 유효한 스왑 → 연쇄까지 모두 끝날 때까지 true
let resolvingMove = false;

// ====== 유틸 ======
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function easeOutCubic(t) {
  t = clamp(t, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function createEmptyBoard() {
  board = new Array(BOARD_SIZE)
    .fill(0)
    .map(() => new Array(BOARD_SIZE).fill(0));
}

function randomTile() {
  return Math.floor(Math.random() * TILE_TYPES);
}

// 초기 보드: 3매칭 없이 생성
function generateInitialBoard() {
  createEmptyBoard();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      let t;
      do {
        t = randomTile();
      } while (
        (c >= 2 && board[r][c - 1] === t && board[r][c - 2] === t) ||
        (r >= 2 && board[r - 1][c] === t && board[r - 2][c] === t)
      );
      board[r][c] = t;
    }
  }
}

function updateUI() {
  scoreText.textContent = score;
  movesText.textContent = moves;
}

// ====== 매치 찾기 ======
function findMatches() {
  const matches = [];

  // 가로
  for (let r = 0; r < BOARD_SIZE; r++) {
    let runStart = 0;
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const current = c < BOARD_SIZE ? board[r][c] : null;
      const prev = board[r][c - 1];
      if (c < BOARD_SIZE && current === prev && current != null) {
        continue;
      }
      const runLength = c - runStart;
      if (runLength >= 3 && board[r][runStart] != null) {
        for (let k = 0; k < runLength; k++) {
          matches.push({ row: r, col: runStart + k });
        }
      }
      runStart = c;
    }
  }

  // 세로
  for (let c = 0; c < BOARD_SIZE; c++) {
    let runStart = 0;
    for (let r = 1; r <= BOARD_SIZE; r++) {
      const current = r < BOARD_SIZE ? board[r][c] : null;
      const prev = board[r - 1][c];
      if (r < BOARD_SIZE && current === prev && current != null) {
        continue;
      }
      const runLength = r - runStart;
      if (runLength >= 3 && board[runStart][c] != null) {
        for (let k = 0; k < runLength; k++) {
          matches.push({ row: runStart + k, col: c });
        }
      }
      runStart = r;
    }
  }

  // 중복 제거
  const unique = [];
  const seen = new Set();
  for (const m of matches) {
    const key = `${m.row},${m.col}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(m);
    }
  }
  return unique;
}

// ====== 중력 (위에서 아래로 떨어지는 로직 + 애니메이션용 move 정보) ======
function applyGravityWithMoves() {
  const movesArr = [];

  for (let c = 0; c < BOARD_SIZE; c++) {
    let destRow = BOARD_SIZE - 1;

    // 아래에서 위로 → null 아닌 타일을 아래쪽으로 몰기
    for (let r = BOARD_SIZE - 1; r >= 0; r--) {
      if (board[r][c] != null) {
        const t = board[r][c];
        if (destRow !== r) {
          board[destRow][c] = t;
          board[r][c] = null;
          movesArr.push({
            type: t,
            fromRow: r,
            fromCol: c,
            toRow: destRow,
            toCol: c,
            isNew: false,
          });
        }
        destRow--;
      }
    }

    // 남은 위쪽 빈 칸 → 새 타일로 채우기
    for (let r = destRow; r >= 0; r--) {
      const t = randomTile();
      board[r][c] = t;
      // 위에서 떨어지는 느낌을 위해 시작 row를 음수로
      const fromRow = -(destRow - r + 1);
      movesArr.push({
        type: t,
        fromRow,
        fromCol: c,
        toRow: r,
        toCol: c,
        isNew: true,
      });
    }
  }

  return movesArr;
}

// ====== 타일 그리기 ======
function colorForType(type) {
  switch (type) {
    case 0:
      return "#fb923c"; // 주황
    case 1:
      return "#22c55e"; // 초록
    case 2:
      return "#3b82f6"; // 파랑
    case 3:
      return "#a855f7"; // 보라
    case 4:
    default:
      return "#fb7185"; // 핑크
  }
}

// 캔버스에 하나의 타일을 그리는 함수
function drawTile(type, cx, cy, options = {}) {
  const { scale = 1, alpha = 1, glow = 0 } = options;

  if (type == null) return;

  const size = (TILE_SIZE - TILE_MARGIN * 2) * scale;
  const x = cx - size / 2;
  const y = cy - size / 2;
  const radius = 12 * scale;

  ctx.save();
  ctx.globalAlpha = alpha;

  // 그림자 + 약간의 글로우
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 배경 사각형
  ctx.fillStyle = colorForType(type);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, size, size, radius);
  } else {
    // 브라우저 호환용 fallback
    ctx.rect(x, y, size, size);
  }
  ctx.fill();

  // 하이라이트 반사
  // const grad = ctx.createRadialGradient(
  //   x + size * 0.2,
  //   y + size * 0.2,
  //   4,
  //   x + size * 0.2,
  //   y + size * 0.2,
  //   size * 0.9
  // );
  // grad.addColorStop(0, "rgba(255,255,255,0.32)");
  // grad.addColorStop(0.4, "rgba(255,255,255,0.08)");
  // grad.addColorStop(1, "rgba(255,255,255,0.0)");
  // ctx.fillStyle = grad;
  // ctx.fill();

  // 이모지 (텍스트)
  ctx.shadowColor = "transparent";
  ctx.font = `${Math.floor(
    TILE_SIZE * 0.6
  )}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  const emoji = EMOJIS[type % EMOJIS.length];
  ctx.fillText(emoji, cx, cy + 2); // 약간 아래로 내려서 가운데 느낌

  ctx.restore();
}

// ====== 보드 전체 그리기 ======
function drawBoard(timestamp) {
  const now = timestamp || performance.now();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 배경
  ctx.save();
  ctx.fillStyle = "#111827"; // 또는 "#000000", "#1f2933" 등 취향대로
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.restore();

  const anim = currentAnimation;

  let swapInfo = null;
  let clearInfo = null;
  let fallInfo = null;

  if (anim) {
    const t = (now - anim.startTime) / anim.duration;

    if (anim.type === "swap") {
      swapInfo = {
        progress: clamp(t, 0, 1),
        tiles: anim.tiles,
        valid: anim.valid,
      };
    } else if (anim.type === "clear") {
      clearInfo = {
        progress: clamp(t, 0, 1),
        matches: anim.matches,
      };
    } else if (anim.type === "fall") {
      fallInfo = {
        progress: clamp(t, 0, 1),
        moves: anim.moves,
      };
    }
  }

  // 매치 타일 빠르게 찾기용 Set
  let clearSet = null;
  if (clearInfo) {
    clearSet = new Set(clearInfo.matches.map((m) => `${m.row},${m.col}`));
  }

  // 낙하 중인 목적지 칸은 static draw에서 스킵
  let fallDestSet = null;
  if (fallInfo) {
    fallDestSet = new Set(fallInfo.moves.map((m) => `${m.toRow},${m.toCol}`));
  }

  // 스왑 중인 타일 위치는 static draw에서 스킵
  let swapSkipSet = null;
  if (swapInfo) {
    swapSkipSet = new Set();
    for (const tInfo of swapInfo.tiles) {
      swapSkipSet.add(`${tInfo.fromRow},${tInfo.fromCol}`);
      swapSkipSet.add(`${tInfo.toRow},${tInfo.toCol}`);
    }
  }

  // ==== 기본 타일 그리기 (애니메이션 중이 아닌 것들) ====
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const type = board[r][c];
      if (type == null) continue;

      const key = `${r},${c}`;

      if (swapSkipSet && swapSkipSet.has(key)) {
        // 스왑 중인 타일은 따로 그림
        continue;
      }
      if (fallDestSet && fallDestSet.has(key)) {
        // 낙하 중인 타일도 따로 그림
        continue;
      }

      let scale = 1;
      let alpha = 1;
      let glow = 0; // 항상 0으로 둘 거라 사실 필요 없음

      if (clearSet && clearSet.has(key)) {
        const p = clearInfo.progress; // 0 ~ 1
        // 살짝 커졌다가 사라지는 정도만
        scale = 1 + 0.1 * Math.sin(p * Math.PI); // 1 → 1.1 → 1
        alpha = 1 - p * 0.7; // 점점 투명
        // glow는 항상 0 유지
      }

      const cx = (c + 0.5) * TILE_SIZE;
      const cy = (r + 0.5) * TILE_SIZE;
      drawTile(type, cx, cy, { scale, alpha, glow });
    }
  }

  // ==== 스왑 애니메이션 타일 그리기 ====
  if (swapInfo) {
    const pRaw = swapInfo.progress;
    const p = clamp(pRaw, 0, 1);
    for (const tInfo of swapInfo.tiles) {
      const { type, fromRow, fromCol, toRow, toCol } = tInfo;
      const startX = (fromCol + 0.5) * TILE_SIZE;
      const startY = (fromRow + 0.5) * TILE_SIZE;
      const endX = (toCol + 0.5) * TILE_SIZE;
      const endY = (toRow + 0.5) * TILE_SIZE;

      let factor;
      if (swapInfo.valid) {
        factor = p; // 0→1, 부드럽게 자리 교체
      } else {
        // 잘못된 스왑은 왔다갔다 튕기는 느낌
        factor = Math.sin(p * Math.PI); // 0→1→0
      }

      const cx = startX + (endX - startX) * factor;
      const cy = startY + (endY - startY) * factor;
      drawTile(type, cx, cy, { scale: 1, alpha: 1, glow: 0.3 });
    }
  }

  // ==== 낙하 애니메이션 타일 그리기 ====
  if (fallInfo) {
    const pRaw = fallInfo.progress;
    const p = clamp(pRaw, 0, 1);
    const eased = easeOutCubic(p);

    for (const mv of fallInfo.moves) {
      const { type, fromRow, fromCol, toRow, toCol } = mv;

      const startX = (fromCol + 0.5) * TILE_SIZE;
      const startY = (fromRow + 0.5) * TILE_SIZE;
      const endX = (toCol + 0.5) * TILE_SIZE;
      const endY = (toRow + 0.5) * TILE_SIZE;

      const cx = startX + (endX - startX) * eased;
      const cy = startY + (endY - startY) * eased;
      const alpha = pRaw < 0.2 ? pRaw / 0.2 : 1; // 처음에 살짝 페이드인

      drawTile(type, cx, cy, { scale: 1, alpha, glow: 0 });
    }
  }

  // 선택된 칸 표시 (테두리)
  if (selected && !currentAnimation) {
    const { row, col } = selected;
    const x = col * TILE_SIZE;
    const y = row * TILE_SIZE;
    ctx.save();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      x + TILE_MARGIN / 2,
      y + TILE_MARGIN / 2,
      TILE_SIZE - TILE_MARGIN,
      TILE_SIZE - TILE_MARGIN
    );
    ctx.restore();
  }
}

// ====== 애니메이션 진행 관리 ======
function updateAnimation(timestamp) {
  if (!currentAnimation) return;
  const anim = currentAnimation;
  const now = timestamp || performance.now();
  const progress = (now - anim.startTime) / anim.duration;

  if (progress < 1) {
    return;
  }

  // 애니메이션 종료 시점 처리
  if (anim.type === "swap") {
    if (anim.valid) {
      // 유효한 스왑 → 매치 클리어 시작
      startClearAnimation(anim.matches, 0);
    } else {
      // 잘못된 스왑 → 그냥 애니만 보여주고 끝
      currentAnimation = null;
      resolvingMove = false;
      selected = null;
    }
  } else if (anim.type === "clear") {
    // 매치 타일 실제 제거
    for (const pos of anim.matches) {
      board[pos.row][pos.col] = null;
    }
    const moves = applyGravityWithMoves();
    if (moves.length > 0) {
      startFallAnimation(moves, anim.chain);
    } else {
      // 중력으로 움직인 게 없으면 바로 종료
      endMoveResolution();
    }
  } else if (anim.type === "fall") {
    // 낙하 후 연쇄 매치 확인
    const newMatches = findMatches();
    if (newMatches.length > 0) {
      startClearAnimation(newMatches, anim.chain + 1);
    } else {
      endMoveResolution();
    }
  }
}

// 유효한 스왑 이후의 클리어 애니 시작
function startClearAnimation(matches, chain) {
  if (!matches || matches.length === 0) {
    endMoveResolution();
    return;
  }

  // 점수: 매치 개수 x 10 x (1 + 연쇄)
  const base = 10;
  score += matches.length * base * (1 + chain);
  updateUI();

  currentAnimation = {
    type: "clear",
    matches,
    chain,
    startTime: performance.now(),
    duration: CLEAR_DURATION,
  };
}

// 중력 낙하 애니 시작
function startFallAnimation(movesArr, chain) {
  currentAnimation = {
    type: "fall",
    moves: movesArr,
    chain,
    startTime: performance.now(),
    duration: FALL_DURATION,
  };
}

// 한 번의 유효한 이동이 완전히 끝났을 때
function endMoveResolution() {
  if (resolvingMove) {
    moves--;
    resolvingMove = false;
    updateUI();
    checkGameOver();
  }
  currentAnimation = null;
  selected = null;
}

// ====== 스왑 처리 (유효/무효 판정 + 애니메이션) ======
function swapValues(r1, c1, r2, c2) {
  const tmp = board[r1][c1];
  board[r1][c1] = board[r2][c2];
  board[r2][c2] = tmp;
}

// 스왑 시도
function trySwap(r1, c1, r2, c2) {
  if (currentAnimation) return;

  const typeA = board[r1][c1];
  const typeB = board[r2][c2];

  // 유효한 매치인지 체크 → 먼저 스왑해보고 매치 있는지 본 다음 되돌리기
  swapValues(r1, c1, r2, c2);
  const matches = findMatches();
  const isValid = matches.length > 0;
  // 원상복구
  swapValues(r1, c1, r2, c2);

  if (!isValid) {
    // 잘못된 스왑 → 왔다갔다 튕기는 애니
    currentAnimation = {
      type: "swap",
      valid: false,
      tiles: [
        {
          type: typeA,
          fromRow: r1,
          fromCol: c1,
          toRow: r2,
          toCol: c2,
        },
        {
          type: typeB,
          fromRow: r2,
          fromCol: c2,
          toRow: r1,
          toCol: c1,
        },
      ],
      matches: [],
      startTime: performance.now(),
      duration: SWAP_DURATION,
    };
    return;
  }

  // 유효한 스왑 → 실제로 보드 값 교체 후, 연쇄 처리 예약
  swapValues(r1, c1, r2, c2);
  const afterMatches = findMatches();
  resolvingMove = true;

  currentAnimation = {
    type: "swap",
    valid: true,
    tiles: [
      {
        type: typeA,
        fromRow: r1,
        fromCol: c1,
        toRow: r2,
        toCol: c2,
      },
      {
        type: typeB,
        fromRow: r2,
        fromCol: c2,
        toRow: r1,
        toCol: c1,
      },
    ],
    matches: afterMatches,
    startTime: performance.now(),
    duration: SWAP_DURATION,
  };
}

// ====== 입력 처리 (캔버스 클릭 → 그리드 좌표 변환) ======
function handleCanvasClick(evt) {
  if (currentAnimation) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const x = (evt.clientX - rect.left) * scaleX;
  const y = (evt.clientY - rect.top) * scaleY;

  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);

  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    return;
  }

  if (selected && selected.row === row && selected.col === col) {
    // 같은 칸 다시 클릭 → 선택 해제
    selected = null;
    return;
  }

  if (!selected) {
    selected = { row, col };
    return;
  }

  const dr = Math.abs(selected.row - row);
  const dc = Math.abs(selected.col - col);

  if (dr + dc === 1) {
    // 인접 칸 → 스왑 시도
    const from = { ...selected };
    selected = { row, col }; // 둘 다 하이라이트
    trySwap(from.row, from.col, row, col);
  } else {
    // 인접 아니면 선택 위치만 변경
    selected = { row, col };
  }
}

// ====== 게임 상태 ======
function checkGameOver() {
  if (moves <= 0) {
    overlayTitle.textContent = "게임 종료!";
    overlayScore.textContent = `최종 점수: ${score.toLocaleString()}점`;
    overlay.classList.add("show");
  }
}

function resetGame() {
  score = 0;
  moves = MAX_MOVES;
  selected = null;
  resolvingMove = false;
  currentAnimation = null;
  overlay.classList.remove("show");
  generateInitialBoard();
  updateUI();
}

// ====== 메인 루프 ======
function gameLoop(timestamp) {
  const now = timestamp || performance.now();
  updateAnimation(now);
  drawBoard(now);
  requestAnimationFrame(gameLoop);
}

// ====== 초기화 ======
canvas.addEventListener("click", handleCanvasClick);
resetBtn.addEventListener("click", resetGame);
restartBtn.addEventListener("click", resetGame);

resetGame();
requestAnimationFrame(gameLoop);
