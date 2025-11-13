const COLORS = [
  "\u001b[38;5;39m", // cyan
  "\u001b[38;5;208m", // orange
  "\u001b[38;5;135m", // magenta
  "\u001b[38;5;83m", // green
  "\u001b[38;5;178m", // mustard
  "\u001b[38;5;213m", // pink
  "\u001b[38;5;75m", // blue
  "\u001b[38;5;244m", // gray
];
const RESET = "\u001b[0m";

const labelPalette = new Map<string, string>();
let colorIndex = 0;

function labelColor(label: string): string {
  const existing = labelPalette.get(label);
  if (existing) {
    return existing;
  }
  const color = COLORS[colorIndex % COLORS.length];
  labelPalette.set(label, color);
  colorIndex += 1;
  return color;
}

function formatLabel(label: string): string {
  const color = labelColor(label);
  return `${color}[${label}]${RESET}`;
}

function logWithLabel(label: string, message: string, ...args: unknown[]): void {
  console.log(formatLabel(label), message, ...args);
}

function warnWithLabel(label: string, message: string, ...args: unknown[]): void {
  console.warn(formatLabel(label), message, ...args);
}

function errorWithLabel(label: string, message: string, ...args: unknown[]): void {
  console.error(formatLabel(label), message, ...args);
}

export { logWithLabel, warnWithLabel, errorWithLabel };
