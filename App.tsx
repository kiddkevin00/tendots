import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const COLS = 9;
const STORAGE_KEY = 'tendots:state:v1';

// Standard pen-and-paper opening sequence used by this family of puzzles.
const SEED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 1, 1, 2, 1, 3, 1, 4, 1, 5];

type Cell = { id: string; value: number; crossed: boolean };

type SavedState = {
  highScoreAdds: number | null; // fewest adds used to clear the board
  totalClears: number;
  haptics: boolean;
};

function makeInitial(): Cell[] {
  return SEED.map((v, i) => ({ id: `seed-${i}`, value: v, crossed: false }));
}

function rcOf(idx: number) {
  return { r: Math.floor(idx / COLS), c: idx % COLS };
}

function canMatch(cells: Cell[], a: number, b: number): boolean {
  if (a === b) return false;
  const A = cells[a];
  const B = cells[b];
  if (!A || !B || A.crossed || B.crossed) return false;
  if (A.value !== B.value && A.value + B.value !== 10) return false;

  // Reading-order adjacency: every cell strictly between a and b in
  // index order is crossed. This subsumes "next to each other" and
  // "end-of-row wraps to start-of-next-row".
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let readingOk = true;
  for (let i = lo + 1; i < hi; i++) {
    if (!cells[i].crossed) {
      readingOk = false;
      break;
    }
  }
  if (readingOk) return true;

  // Column adjacency: same column, all cells between in that column crossed.
  const ra = rcOf(a);
  const rb = rcOf(b);
  if (ra.c === rb.c) {
    const r1 = Math.min(ra.r, rb.r);
    const r2 = Math.max(ra.r, rb.r);
    let ok = true;
    for (let r = r1 + 1; r < r2; r++) {
      const idx = r * COLS + ra.c;
      if (idx >= cells.length || !cells[idx].crossed) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }

  // Diagonal adjacency: |dr| === |dc|, all cells between on that
  // diagonal are crossed.
  const dr = Math.sign(rb.r - ra.r);
  const dc = Math.sign(rb.c - ra.c);
  if (dr !== 0 && Math.abs(rb.r - ra.r) === Math.abs(rb.c - ra.c)) {
    let r = ra.r + dr;
    let c = ra.c + dc;
    let ok = true;
    while (r !== rb.r || c !== rb.c) {
      const idx = r * COLS + c;
      if (idx < 0 || idx >= cells.length || c < 0 || c >= COLS || !cells[idx].crossed) {
        ok = false;
        break;
      }
      r += dr;
      c += dc;
    }
    if (ok) return true;
  }

  return false;
}

function findAnyPair(cells: Cell[]): [number, number] | null {
  const live: number[] = [];
  for (let i = 0; i < cells.length; i++) if (!cells[i].crossed) live.push(i);
  // Try every pair where one comes within a "near" window of the other,
  // plus column / diagonal candidates. The board is small enough to brute
  // force O(n^2) without breaking a sweat.
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (canMatch(cells, live[i], live[j])) return [live[i], live[j]];
    }
  }
  return null;
}

function isBoardCleared(cells: Cell[]): boolean {
  return cells.every((c) => c.crossed);
}

export default function App() {
  const [cells, setCells] = useState<Cell[]>(makeInitial);
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<[number, number] | null>(null);
  const [pairs, setPairs] = useState(0);
  const [adds, setAdds] = useState(0);
  const [highScoreAdds, setHighScoreAdds] = useState<number | null>(null);
  const [totalClears, setTotalClears] = useState(0);
  const [haptics, setHaptics] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [winOpen, setWinOpen] = useState(false);
  const [stuckOpen, setStuckOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const s = JSON.parse(raw) as Partial<SavedState>;
          if (typeof s.highScoreAdds === 'number' || s.highScoreAdds === null) {
            setHighScoreAdds(s.highScoreAdds ?? null);
          }
          if (typeof s.totalClears === 'number') setTotalClears(s.totalClears);
          if (typeof s.haptics === 'boolean') setHaptics(s.haptics);
        }
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ highScoreAdds, totalClears, haptics } satisfies SavedState),
    ).catch(() => {});
  }, [highScoreAdds, totalClears, haptics, loaded]);

  const tap = useCallback(
    (kind: 'light' | 'medium' | 'success' | 'warning' = 'light') => {
      if (!haptics) return;
      if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else if (kind === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      else if (kind === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      else Haptics.selectionAsync().catch(() => {});
    },
    [haptics],
  );

  const newGame = useCallback(() => {
    setCells(makeInitial());
    setSelected(null);
    setHint(null);
    setPairs(0);
    setAdds(0);
    setWinOpen(false);
    setStuckOpen(false);
    setMenuOpen(false);
  }, []);

  const handleCellTap = useCallback(
    (idx: number) => {
      const cell = cells[idx];
      if (!cell || cell.crossed) return;
      // Clear any active hint glow as soon as the user moves.
      if (hint) setHint(null);

      if (selected == null) {
        setSelected(idx);
        tap('light');
        return;
      }
      if (selected === idx) {
        setSelected(null);
        tap('light');
        return;
      }
      if (canMatch(cells, selected, idx)) {
        const a = selected;
        const b = idx;
        const nextCells = cells.map((c, i) =>
          i === a || i === b ? { ...c, crossed: true } : c,
        );
        setCells(nextCells);
        setPairs((p) => p + 1);
        setSelected(null);
        tap('success');
        if (isBoardCleared(nextCells)) {
          // Win — fewest-adds counts as best.
          setHighScoreAdds((prev) => (prev == null ? adds : Math.min(prev, adds)));
          setTotalClears((n) => n + 1);
          setWinOpen(true);
        }
      } else {
        // Invalid — switch selection to the newly tapped cell instead of
        // forcing the user to deselect first.
        setSelected(idx);
        tap('warning');
      }
    },
    [cells, selected, hint, adds, tap],
  );

  const addRow = useCallback(() => {
    // Append all live (un-crossed) cells in reading order to the end of
    // the board. This is the standard pen-and-paper escape hatch.
    const live = cells.filter((c) => !c.crossed);
    if (live.length === 0) return;
    const stamp = `${Date.now()}-${adds + 1}`;
    const copied: Cell[] = live.map((c, i) => ({
      id: `${stamp}-${i}`,
      value: c.value,
      crossed: false,
    }));
    setCells([...cells, ...copied]);
    setAdds((n) => n + 1);
    setSelected(null);
    setHint(null);
    tap('medium');
  }, [cells, adds, tap]);

  const showHint = useCallback(() => {
    const pair = findAnyPair(cells);
    if (pair) {
      setHint(pair);
      tap('medium');
    } else {
      setStuckOpen(true);
      tap('warning');
    }
  }, [cells, tap]);

  const liveCount = useMemo(() => cells.filter((c) => !c.crossed).length, [cells]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>
            Ten<Text style={styles.brandItalic}>Dots</Text>
          </Text>
          <Text style={styles.brandSub}>
            {pairs} {pairs === 1 ? 'pair' : 'pairs'} · {liveCount} left
          </Text>
        </View>
        <Pressable
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Text style={styles.menuBtnText}>•••</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <Stat label="ADDS" value={String(adds)} />
        <Stat label="BEST ADDS" value={highScoreAdds == null ? '—' : String(highScoreAdds)} />
        <Stat label="CLEARED" value={String(totalClears)} />
      </View>

      <ScrollView
        contentContainerStyle={styles.boardWrap}
        showsVerticalScrollIndicator={false}
      >
        <Board
          cells={cells}
          selected={selected}
          hint={hint}
          onCellTap={handleCellTap}
        />
        <View style={{ height: 12 }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <BarBtn label="Hint" onPress={showHint} />
        <BarBtn
          label="Add"
          onPress={addRow}
          primary
          disabled={liveCount === 0}
        />
        <BarBtn label="Reset" onPress={newGame} />
      </View>

      {/* Win modal */}
      <Modal visible={winOpen} transparent animationType="fade" onRequestClose={() => setWinOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>BOARD CLEARED</Text>
            <Text style={styles.modalBig}>{pairs}</Text>
            <Text style={styles.modalSub}>pairs · {adds} {adds === 1 ? 'add' : 'adds'}</Text>
            <Text style={styles.modalHint}>
              {highScoreAdds === adds
                ? 'New best — fewest adds yet.'
                : `Your best is ${highScoreAdds} ${highScoreAdds === 1 ? 'add' : 'adds'}.`}
            </Text>
            <Pressable
              onPress={newGame}
              style={({ pressed }) => [styles.modalPrimary, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.modalPrimaryText}>Play again</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Stuck modal */}
      <Modal visible={stuckOpen} transparent animationType="fade" onRequestClose={() => setStuckOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>NO PAIRS LEFT</Text>
            <Text style={styles.modalLede}>
              Nothing matches under the rules. Tap <Text style={styles.kbd}>Add</Text> to
              append the remaining numbers and keep going, or reset.
            </Text>
            <View style={{ height: 14 }} />
            <Pressable
              onPress={() => {
                setStuckOpen(false);
                addRow();
              }}
              style={({ pressed }) => [styles.modalPrimary, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.modalPrimaryText}>Add row</Text>
            </Pressable>
            <Pressable
              onPress={() => setStuckOpen(false)}
              style={styles.modalLinkBtn}
              hitSlop={8}
            >
              <Text style={styles.modalLinkText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Menu modal — rules + settings */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>HOW TO PLAY</Text>
            <Text style={styles.modalRule}>
              Tap two numbers to clear them. They must either be the{' '}
              <Text style={styles.bold}>same</Text> or{' '}
              <Text style={styles.bold}>sum to ten</Text>.
            </Text>
            <Text style={styles.modalRule}>
              The two cells must be next to each other in reading order,
              the same column, or a diagonal — with only crossed-out cells
              between them.
            </Text>
            <Text style={styles.modalRule}>
              When you're stuck, <Text style={styles.bold}>Add</Text>{' '}
              copies the remaining numbers to the bottom. The fewer adds,
              the better.
            </Text>
            <View style={styles.menuActions}>
              <Pressable
                onPress={() => setHaptics((h) => !h)}
                style={styles.modalLinkBtn}
                hitSlop={8}
              >
                <Text style={styles.modalLinkText}>
                  {haptics ? '◉ Haptics on' : '◯ Haptics off'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  Alert.alert('Reset all?', 'Clear the current game and your best record.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset all',
                      style: 'destructive',
                      onPress: () => {
                        setHighScoreAdds(null);
                        setTotalClears(0);
                        newGame();
                      },
                    },
                  ]);
                }}
                style={styles.modalLinkBtn}
                hitSlop={8}
              >
                <Text style={[styles.modalLinkText, { color: COLORS.warn }]}>Reset records</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => setMenuOpen(false)}
              style={({ pressed }) => [styles.modalPrimary, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.modalPrimaryText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function BarBtn({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.barBtn,
        primary && styles.barBtnPrimary,
        disabled && styles.barBtnDisabled,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.barBtnText, primary && styles.barBtnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const { width: SCREEN_W } = Dimensions.get('window');
const BOARD_PADDING = 12;
const CELL_GAP = 5;
const CELL_SIZE = Math.floor((SCREEN_W - BOARD_PADDING * 2 - CELL_GAP * (COLS - 1)) / COLS);

function Board({
  cells,
  selected,
  hint,
  onCellTap,
}: {
  cells: Cell[];
  selected: number | null;
  hint: [number, number] | null;
  onCellTap: (idx: number) => void;
}) {
  const hintSet = hint ? new Set(hint) : null;
  const rows: Cell[][] = [];
  for (let i = 0; i < cells.length; i += COLS) rows.push(cells.slice(i, i + COLS));
  return (
    <View style={styles.board}>
      {rows.map((row, rIdx) => (
        <View key={rIdx} style={styles.boardRow}>
          {row.map((c, cIdx) => {
            const idx = rIdx * COLS + cIdx;
            const isSelected = idx === selected;
            const isHint = hintSet?.has(idx) ?? false;
            return (
              <Pressable
                key={c.id}
                onPress={() => onCellTap(idx)}
                disabled={c.crossed}
                style={({ pressed }) => [
                  styles.cell,
                  c.crossed && styles.cellCrossed,
                  isSelected && styles.cellSelected,
                  isHint && styles.cellHint,
                  pressed && !c.crossed && { transform: [{ scale: 0.92 }] },
                ]}
              >
                <Text
                  style={[
                    styles.cellText,
                    c.crossed && styles.cellTextCrossed,
                    isSelected && styles.cellTextSelected,
                  ]}
                >
                  {c.value}
                </Text>
              </Pressable>
            );
          })}
          {/* Pad the last row visually so it's left-aligned in the grid. */}
          {row.length < COLS &&
            Array.from({ length: COLS - row.length }).map((_, i) => (
              <View key={`pad-${i}`} style={[styles.cell, styles.cellPad]} />
            ))}
        </View>
      ))}
    </View>
  );
}

const COLORS = {
  bg: '#f4f1ea',
  card: '#fffefb',
  ink: '#1c1b18',
  inkMuted: '#5a5750',
  inkSubtle: '#928f86',
  rule: '#d7d1c1',
  ruleSoft: '#ebe6d6',
  accent: '#345b7d',
  accentDeep: '#1f3a55',
  accentSoft: '#dbe5ef',
  warn: '#a74220',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 22, paddingTop: 8, paddingBottom: 8,
  },
  brand: { fontSize: 26, fontWeight: '700', color: COLORS.ink, letterSpacing: -0.4 },
  brandItalic: { fontStyle: 'italic', color: COLORS.accent, fontWeight: '600' },
  brandSub: { fontSize: 12, color: COLORS.inkSubtle, marginTop: 2 },
  menuBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  menuBtnText: { color: COLORS.inkMuted, fontSize: 22, lineHeight: 22 },

  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 22, paddingTop: 4, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  stat: { alignItems: 'center' },
  statLabel: { fontSize: 10, color: COLORS.inkSubtle, letterSpacing: 1.5 },
  statValue: { fontSize: 20, color: COLORS.ink, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 2 },

  boardWrap: { paddingHorizontal: BOARD_PADDING, paddingTop: 18 },
  board: { gap: CELL_GAP },
  boardRow: { flexDirection: 'row', gap: CELL_GAP },
  cell: {
    width: CELL_SIZE, height: CELL_SIZE,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  cellCrossed: {
    backgroundColor: 'transparent',
    shadowOpacity: 0,
  },
  cellSelected: {
    backgroundColor: COLORS.accent,
    shadowOpacity: 0.18, shadowRadius: 6,
  },
  cellHint: {
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
  },
  cellPad: { backgroundColor: 'transparent', shadowOpacity: 0 },
  cellText: { fontSize: 22, fontWeight: '600', color: COLORS.ink, fontVariant: ['tabular-nums'] },
  cellTextCrossed: { color: COLORS.ruleSoft, fontWeight: '400', textDecorationLine: 'line-through' },
  cellTextSelected: { color: '#fff' },

  bottomBar: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 22, paddingTop: 12, paddingBottom: 20,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.rule,
  },
  barBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.rule,
  },
  barBtnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  barBtnDisabled: { opacity: 0.4 },
  barBtnText: { color: COLORS.ink, fontSize: 14, fontWeight: '600', letterSpacing: 0.3 },
  barBtnTextPrimary: { color: '#fff' },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(20,18,15,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modalCard: {
    backgroundColor: COLORS.card, borderRadius: 20,
    padding: 26, width: '100%', maxWidth: 360,
    alignItems: 'center',
  },
  modalEyebrow: { fontSize: 11, color: COLORS.accent, letterSpacing: 2.5, fontWeight: '700' },
  modalBig: { fontSize: 56, color: COLORS.ink, fontWeight: '300', marginTop: 6, fontVariant: ['tabular-nums'] },
  modalSub: { fontSize: 13, color: COLORS.inkMuted, marginBottom: 14, fontVariant: ['tabular-nums'] },
  modalHint: { fontSize: 13, color: COLORS.inkMuted, marginBottom: 18, textAlign: 'center' },
  modalLede: { fontSize: 14, color: COLORS.inkMuted, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  modalRule: { fontSize: 13, color: COLORS.inkMuted, marginTop: 10, lineHeight: 19 },
  bold: { color: COLORS.ink, fontWeight: '600' },
  kbd: {
    fontFamily: 'Menlo', fontSize: 12, color: COLORS.ink,
    backgroundColor: COLORS.ruleSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
  },
  modalPrimary: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 999,
    marginTop: 8,
  },
  modalPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: 0.3 },
  modalLinkBtn: { paddingVertical: 8 },
  modalLinkText: { color: COLORS.inkMuted, fontSize: 13, letterSpacing: 0.5 },
  menuActions: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignSelf: 'stretch', marginTop: 14, marginBottom: 4,
  },
});
