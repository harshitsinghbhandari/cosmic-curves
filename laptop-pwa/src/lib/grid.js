const GRID_RANGE_CM = 45;
const GRID_MAJOR_STEP_CM = 10;
const GRID_MINOR_STEP_CM = 5;
const DOT_RADIUS_PX = 4;
const CURVE_SAMPLE_POINTS = 200;
const RUN_COLORS = ["#4FC3F7","#FF8A65","#A5D6A7","#CE93D8","#FFF176","#EF9A9A","#80DEEA","#FFCC80"];

export default class Grid {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        this.scale = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.runs = [];
        this.visibleRuns = new Set();
        this.runColors = {};
        this.mode = 'both'; 
        this.isDragging = false;
        this.lastX = 0;
        this.lastY = 0;

        window.addEventListener('resize', () => this.resize());
        this.resize();

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomAmount = e.deltaY * -0.001;
            const newScale = Math.min(Math.max(0.5, this.scale + zoomAmount), 4.0);
            
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
            this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
            
            this.scale = newScale;
            this.render();
        });

        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
        });

        window.addEventListener('mouseup', () => this.isDragging = false);

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.offsetX += e.clientX - this.lastX;
                this.offsetY += e.clientY - this.lastY;
                this.lastX = e.clientX;
                this.lastY = e.clientY;
                this.render();
            } else {
                this.handleHover(e);
            }
        });
    }

    setRuns(runs) {
        this.runs = runs;
        
        runs.forEach((r, idx) => {
            if (!this.runColors[r.run_id]) {
                const stored = localStorage.getItem(`color_${r.run_id}`);
                this.runColors[r.run_id] = stored || RUN_COLORS[idx % RUN_COLORS.length];
            }
            const vis = localStorage.getItem(`vis_${r.run_id}`);
            if (vis !== 'false') this.visibleRuns.add(r.run_id);
            else this.visibleRuns.delete(r.run_id);
        });
        
        this.offsetX = this.canvas.width / 2;
        this.offsetY = this.canvas.height / 2;
        
        this.render();
    }

    setMode(mode) {
        this.mode = mode;
        this.render();
    }

    toggleVisibility(runId) {
        if (this.visibleRuns.has(runId)) {
            this.visibleRuns.delete(runId);
            localStorage.setItem(`vis_${runId}`, 'false');
        } else {
            this.visibleRuns.add(runId);
            localStorage.setItem(`vis_${runId}`, 'true');
        }
        this.render();
    }

    cycleColor(runId) {
        const current = this.runColors[runId];
        let idx = RUN_COLORS.indexOf(current);
        idx = (idx + 1) % RUN_COLORS.length;
        this.runColors[runId] = RUN_COLORS[idx];
        localStorage.setItem(`color_${runId}`, RUN_COLORS[idx]);
        this.render();
        return RUN_COLORS[idx];
    }

    cmToPx(cm) {
        const basePxPerCm = Math.min(this.canvas.width, this.canvas.height) / 2 / GRID_RANGE_CM;
        return cm * basePxPerCm * this.scale;
    }

    pxToCm(px) {
        const basePxPerCm = Math.min(this.canvas.width, this.canvas.height) / 2 / GRID_RANGE_CM;
        return px / (basePxPerCm * this.scale);
    }
    
    mapX(cm) { return this.offsetX + this.cmToPx(cm); }
    mapY(cm) { return this.offsetY - this.cmToPx(cm); } 

    resize() {
        if (this.canvas.parentElement) {
            this.canvas.width = this.canvas.parentElement.clientWidth;
            this.canvas.height = this.canvas.parentElement.clientHeight;
            this.offsetX = this.canvas.width / 2;
            this.offsetY = this.canvas.height / 2;
            this.render();
        }
    }

    activeRuns() {
        return this.runs.filter(r => this.visibleRuns.has(r.run_id));
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGrid();
        
        const active = this.activeRuns();
        
        if (this.mode === 'both' || this.mode === 'curve') {
            active.forEach(r => this.drawCurve(r));
        }
        
        if (this.mode === 'both' || this.mode === 'dots') {
            active.forEach(r => this.drawDots(r));
        }

        if (active.length > 0) {
            this.drawBigBallCenter(active[0].big_ball_center);
        }
    }

    drawGrid() {
        this.ctx.lineWidth = 1;
        
        const startXCm = Math.floor(this.pxToCm(-this.offsetX));
        const endXCm = Math.ceil(this.pxToCm(this.canvas.width - this.offsetX));
        const startYCm = Math.floor(this.pxToCm(this.offsetY - this.canvas.height)); 
        const endYCm = Math.ceil(this.pxToCm(this.offsetY));

        for (let x = startXCm; x <= endXCm; x++) {
            if (x % GRID_MINOR_STEP_CM === 0) {
                this.ctx.strokeStyle = x % GRID_MAJOR_STEP_CM === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
                if (x === 0) this.ctx.strokeStyle = 'rgba(255,255,255,0.35)'; 
                this.ctx.beginPath();
                this.ctx.moveTo(this.mapX(x), 0);
                this.ctx.lineTo(this.mapX(x), this.canvas.height);
                this.ctx.stroke();
                
                if (x % GRID_MAJOR_STEP_CM === 0 && x !== 0) {
                    this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    this.ctx.font = '11px monospace';
                    this.ctx.fillText(x, this.mapX(x) + 4, this.mapY(0) + 14);
                }
            }
        }

        for (let y = startYCm; y <= endYCm; y++) {
            if (y % GRID_MINOR_STEP_CM === 0) {
                this.ctx.strokeStyle = y % GRID_MAJOR_STEP_CM === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
                if (y === 0) this.ctx.strokeStyle = 'rgba(255,255,255,0.35)'; 
                this.ctx.beginPath();
                this.ctx.moveTo(0, this.mapY(y));
                this.ctx.lineTo(this.canvas.width, this.mapY(y));
                this.ctx.stroke();
                
                if (y % GRID_MAJOR_STEP_CM === 0 && y !== 0) {
                    this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    this.ctx.font = '11px monospace';
                    this.ctx.fillText(y, this.mapX(0) + 4, this.mapY(y) - 4);
                }
            }
        }
    }

    drawDots(run) {
        this.ctx.fillStyle = this.runColors[run.run_id];
        run.coordinates.forEach(pt => {
            this.ctx.beginPath();
            this.ctx.arc(this.mapX(pt.x_cm), this.mapY(pt.y_cm), DOT_RADIUS_PX, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawCurve(run) {
        this.ctx.strokeStyle = this.runColors[run.run_id];
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();

        const eq = run.equation;
        const c = eq.coefficients;
        const type = eq.type;

        const viewStartX = this.pxToCm(-this.offsetX);
        const viewEndX = this.pxToCm(this.canvas.width - this.offsetX);
        
        let first = true;

        if (type === 'parabola') {
            const step = (viewEndX - viewStartX) / CURVE_SAMPLE_POINTS;
            for (let x = viewStartX; x <= viewEndX; x += step) {
                const y = c.a * x * x + c.b * x + c.c;
                if (first) { this.ctx.moveTo(this.mapX(x), this.mapY(y)); first = false; }
                else { this.ctx.lineTo(this.mapX(x), this.mapY(y)); }
            }
            this.ctx.stroke();
        } else {
            const step = (viewEndX - viewStartX) / CURVE_SAMPLE_POINTS;
            const drawBranch = (sign) => {
                this.ctx.beginPath();
                first = true;
                for (let x = viewStartX; x <= viewEndX; x += step) {
                    const qa = c.C;
                    const qb = c.B * x + c.E;
                    const qc = c.A * x * x + c.D * x + c.F;
                    const discriminant = qb*qb - 4*qa*qc;
                    
                    if (qa === 0) {
                        if (qb !== 0) {
                            const y = -qc / qb;
                            if (first) { this.ctx.moveTo(this.mapX(x), this.mapY(y)); first = false; }
                            else { this.ctx.lineTo(this.mapX(x), this.mapY(y)); }
                        }
                        continue;
                    }

                    if (discriminant >= 0) {
                        const y = (-qb + sign * Math.sqrt(discriminant)) / (2 * qa);
                        if (first) { this.ctx.moveTo(this.mapX(x), this.mapY(y)); first = false; }
                        else { this.ctx.lineTo(this.mapX(x), this.mapY(y)); }
                    } else {
                        first = true;
                    }
                }
                this.ctx.stroke();
            };
            drawBranch(1);
            drawBranch(-1);
        }
    }

    drawBigBallCenter(center) {
        if (!center) return;
        const cx = this.mapX(center.x_cm);
        const cy = this.mapY(center.y_cm);
        
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(cx - 8, cy - 8);
        this.ctx.lineTo(cx + 8, cy + 8);
        this.ctx.moveTo(cx + 8, cy - 8);
        this.ctx.lineTo(cx - 8, cy + 8);
        this.ctx.stroke();
    }

    handleHover(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        let found = null;
        for (const run of this.activeRuns()) {
            for (const pt of run.coordinates) {
                const px = this.mapX(pt.x_cm);
                const py = this.mapY(pt.y_cm);
                const dist = Math.hypot(px - mouseX, py - mouseY);
                if (dist < 8) {
                    found = { x: pt.x_cm, y: pt.y_cm };
                    break;
                }
            }
            if (found) break;
        }

        const tooltip = document.getElementById('tooltip');
        if (found) {
            tooltip.style.left = (e.clientX + 10) + 'px';
            tooltip.style.top = (e.clientY + 10) + 'px';
            tooltip.innerHTML = `x: ${found.x.toFixed(1)}cm<br>y: ${found.y.toFixed(1)}cm`;
            tooltip.style.opacity = 1;
        } else {
            tooltip.style.opacity = 0;
        }
    }
}
