// Frame-time graphs: a small live sparkline for the viewer toolbar, and a full chart of a finished run.

export interface FrameSample {
    tMs: number;         // since the run started
    frameTimeMs: number;
}

// Where a part of the run begins, such as a light count or a camera shot
export interface Segment {
    tMs: number;
    label: string;
}

const lineColor = '#efb15a';
const gridColor = '#292b30';
const textColor = '#8c8e94';

// Reference lines at the frame time each common frame rate allows. The live graph labels them in ms, the results chart in FPS
export const fpsTargets = [120, 60, 30].map(fps => ({ fps, ms: 1000 / fps, label: `${(1000 / fps).toFixed(1)} ms` }));
const referenceColor = '#45474e';

// Rolling line of the most recent frame times. Drawn on a canvas because it updates every frame. Dashed lines mark the
// 120, 60, and 30 FPS frame times, labeled in ms in the axis element beside the canvas. The scale zooms so the slowest line
// above the data sits at 80% of the height.
export class Sparkline {
    private canvas: HTMLCanvasElement;
    private axis?: HTMLElement;
    private samples: number[] = [];
    private readonly capacity = 160;
    private top = 0;

    constructor(canvas: HTMLCanvasElement, axis?: HTMLElement) {
        this.canvas = canvas;
        this.axis = axis;
        canvas.setAttribute('aria-label', `Recent frame times, with lines at ${fpsTargets.map(target => target.label).join(', ')}`);
    }

    clear() {
        this.samples = [];
        this.setTop(0);
        this.draw();
    }

    // Ladder of scale tops: 1.25 × 8.3, 16.7, 33.3, 66.7, … ms, so each top leaves one cutoff at 80% of the height
    private static topFor(maxMs: number): number {
        let cutoff = 1000 / 120;
        while (cutoff * 1.25 < maxMs) cutoff *= 2;
        return cutoff * 1.25;
    }

    private setTop(top: number) {
        if (top === this.top) return;
        this.top = top;
        if (!this.axis) return;
        // Slowest line first, so where two labels would collide the slower one keeps its label
        const height = this.axis.clientHeight;
        const labels: HTMLElement[] = [];
        let lastY = -Infinity;
        for (const target of [...fpsTargets].reverse()) {
            if (top === 0 || target.ms > top) continue;
            const fromTop = (1 - target.ms / top) * height;
            if (Math.abs(fromTop - lastY) < 10) continue;
            lastY = fromTop;
            const label = document.createElement('span');
            label.textContent = target.label;
            label.style.top = `${(1 - target.ms / top) * 100}%`;
            labels.push(label);
        }
        this.axis.replaceChildren(...labels);
    }

    push(frameTimeMs: number) {
        this.samples.push(frameTimeMs);
        if (this.samples.length > this.capacity) this.samples.shift();
        this.draw();
    }

    private draw() {
        const ratio = window.devicePixelRatio || 1;
        const width = Math.round(this.canvas.clientWidth * ratio);
        const height = Math.round(this.canvas.clientHeight * ratio);
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        const context = this.canvas.getContext('2d')!;
        context.clearRect(0, 0, width, height);
        if (this.samples.length < 2) return;

        // Zero-based so a flat line near the bottom means fast, and spikes read as spikes
        this.setTop(Sparkline.topFor(Math.max(...this.samples)));
        const top = this.top;
        const y = (ms: number) => height - (ms / top) * height;

        context.save();
        context.strokeStyle = referenceColor;
        context.lineWidth = ratio;
        context.setLineDash([3 * ratio, 3 * ratio]);
        context.beginPath();
        for (const target of fpsTargets) {
            if (target.ms > top) continue;
            const lineY = Math.round(y(target.ms)) + 0.5 * ratio;
            context.moveTo(0, lineY);
            context.lineTo(width, lineY);
        }
        context.stroke();
        context.restore();

        context.beginPath();
        this.samples.forEach((value, i) => {
            const x = width - (this.samples.length - 1 - i) * (width / (this.capacity - 1));
            const sampleY = Math.max(ratio, y(value));
            if (i === 0) context.moveTo(x, sampleY); else context.lineTo(x, sampleY);
        });
        context.strokeStyle = lineColor;
        context.lineWidth = 1.5 * ratio;
        context.lineJoin = 'round';
        context.stroke();
    }
}

function niceStep(range: number, targetTicks: number): number {
    const rough = range / targetTicks;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const fraction = rough / power;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

function svgElement(name: string, attributes: Record<string, string | number>, text?: string): SVGElement {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
}

// Draws the whole run into container: frame time against time, with a marker where each segment starts and a
// crosshair that reads out the nearest sample. Redraws when the container resizes. Returns a cleanup function.
export function mountFrameChart(container: HTMLElement, samples: FrameSample[], segments: Segment[]): () => void {
    const height = 260;
    const margin = { left: 46, right: 14, top: 26, bottom: 28 };

    const draw = () => {
        container.replaceChildren();
        const width = container.clientWidth;
        if (width < 120 || samples.length < 2) return;

        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;
        const duration = samples[samples.length - 1].tMs;
        const yStep = niceStep(Math.max(...samples.map(sample => sample.frameTimeMs)), 4);
        const yMax = Math.ceil(Math.max(...samples.map(sample => sample.frameTimeMs)) / yStep) * yStep;
        const x = (tMs: number) => margin.left + (tMs / duration) * plotWidth;
        const y = (ms: number) => margin.top + plotHeight - (ms / yMax) * plotHeight;

        const svg = svgElement('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
            'aria-label': `Frame time over the ${(duration / 1000).toFixed(0)}-second run. The table below lists the same run by segment.` });

        // Horizontal grid and frame-time axis
        for (let value = 0; value <= yMax + 1e-9; value += yStep) {
            svg.append(svgElement('line', { x1: margin.left, x2: width - margin.right, y1: y(value), y2: y(value), stroke: gridColor }));
            svg.append(svgElement('text', { x: margin.left - 8, y: y(value) + 3.5, 'text-anchor': 'end', fill: textColor, 'font-size': 10 },
                `${Number(value.toFixed(2))} ms`));
        }

        // Time axis
        const xStep = niceStep(duration / 1000, Math.max(2, Math.floor(plotWidth / 90)));
        for (let seconds = 0; seconds * 1000 <= duration; seconds += xStep) {
            svg.append(svgElement('text', { x: x(seconds * 1000), y: height - 8, 'text-anchor': 'middle', fill: textColor, 'font-size': 10 },
                `${Number(seconds.toFixed(1))} s`));
        }

        // Frame-rate reference lines, labeled inside the plot's right edge
        for (const target of fpsTargets) {
            if (target.ms > yMax) continue;
            svg.append(svgElement('line', { x1: margin.left, x2: width - margin.right, y1: y(target.ms), y2: y(target.ms), stroke: referenceColor, 'stroke-dasharray': '4 4' }));
            svg.append(svgElement('text', { x: width - margin.right - 4, y: y(target.ms) - 4, 'text-anchor': 'end', fill: textColor, 'font-size': 10 }, `${target.fps} FPS`));
        }

        // Segment starts. Labels are dropped where they would collide.
        let lastLabelEnd = -Infinity;
        for (const segment of segments) {
            const sx = x(segment.tMs);
            svg.append(svgElement('line', { x1: sx, x2: sx, y1: margin.top - 4, y2: margin.top + plotHeight, stroke: '#3f4148', 'stroke-dasharray': '2 3' }));
            const labelWidth = segment.label.length * 5.6 + 8;
            if (sx + 4 > lastLabelEnd && sx + labelWidth < width) {
                svg.append(svgElement('text', { x: sx + 4, y: margin.top - 10, fill: textColor, 'font-size': 10 }, segment.label));
                lastLabelEnd = sx + labelWidth;
            }
        }

        svg.append(svgElement('path', {
            d: samples.map((sample, i) => `${i === 0 ? 'M' : 'L'}${x(sample.tMs).toFixed(1)},${y(sample.frameTimeMs).toFixed(1)}`).join(''),
            fill: 'none', stroke: lineColor, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        }));

        // Hover layer
        const crosshair = svgElement('line', { y1: margin.top, y2: margin.top + plotHeight, stroke: '#6c6f78', visibility: 'hidden' });
        const dot = svgElement('circle', { r: 4, fill: lineColor, stroke: '#111214', 'stroke-width': 2, visibility: 'hidden' });
        const hitArea = svgElement('rect', { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight, fill: 'transparent' });
        svg.append(crosshair, dot, hitArea);

        const tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        tooltip.hidden = true;

        const hide = () => {
            crosshair.setAttribute('visibility', 'hidden');
            dot.setAttribute('visibility', 'hidden');
            tooltip.hidden = true;
        };
        hitArea.addEventListener('pointerleave', hide);
        hitArea.addEventListener('pointermove', (event) => {
            const bounds = svg.getBoundingClientRect();
            const tMs = ((event.clientX - bounds.left - margin.left) / plotWidth) * duration;

            // Nearest sample in time
            let low = 0;
            let high = samples.length - 1;
            while (high - low > 1) {
                const middle = (low + high) >> 1;
                if (samples[middle].tMs < tMs) low = middle; else high = middle;
            }
            const sample = Math.abs(samples[low].tMs - tMs) <= Math.abs(samples[high].tMs - tMs) ? samples[low] : samples[high];
            const segment = [...segments].reverse().find(candidate => candidate.tMs <= sample.tMs);

            const sx = x(sample.tMs);
            const sy = y(sample.frameTimeMs);
            crosshair.setAttribute('x1', String(sx));
            crosshair.setAttribute('x2', String(sx));
            crosshair.setAttribute('visibility', 'visible');
            dot.setAttribute('cx', String(sx));
            dot.setAttribute('cy', String(sy));
            dot.setAttribute('visibility', 'visible');

            const value = document.createElement('strong');
            value.textContent = `${sample.frameTimeMs.toFixed(2)} ms`;
            const detail = document.createElement('span');
            detail.textContent = `${(1000 / sample.frameTimeMs).toFixed(0)} FPS · ${(sample.tMs / 1000).toFixed(1)} s${segment ? ` · ${segment.label}` : ''}`;
            tooltip.replaceChildren(value, detail);
            tooltip.hidden = false;
            // Flip to the left of the crosshair near the right edge
            const flip = sx > width - 190;
            tooltip.style.left = flip ? '' : `${sx + 12}px`;
            tooltip.style.right = flip ? `${width - sx + 12}px` : '';
            tooltip.style.top = `${Math.max(margin.top, sy - 44)}px`;
        });

        container.append(svg, tooltip);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
}
