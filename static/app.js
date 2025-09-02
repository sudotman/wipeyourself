(function(){
	const API_BASE = (window.SEEK_API_BASE || '').replace(/\/$/, '');
	const API = {
		list: (limit=60) => fetch(`${API_BASE}/api/images?limit=${limit}`).then(r=>r.json())
	};

	const stage = document.getElementById('stage');
	const canvas = document.getElementById('canvas');
	const loading = document.getElementById('loading');
	const recenterBtn = document.getElementById('recenter');
	const tray = document.getElementById('tray');
	const trayItems = document.getElementById('tray-items');

	const GRID_SIZE = 380;
	const MAX_PER_CELL = 4;
	const MAX_PER_BATCH = 18;
	const LONG_PRESS_MS = 280;
	const FRICTION = 0.90;
	const LERP = 0.14;
	const GRID_CLUSTER_RADIUS = 800;
	const GRID_CLUSTER_MAX = 24;
	const GRID_GAP = 16;
	const PAN_CANCEL_PX = 6;
	const EXPAND_RADIUS = 900;
	const EXPAND_GAP = 18;

	const used = new Set();
	const occupancy = new Map();
	let loadingBatch = false;

	let worldWidth = canvas.clientWidth;
	let worldHeight = canvas.clientHeight;
	let targetX = 0, targetY = 0;
	let viewX = 0, viewY = 0;
	let inertiaVX = 0, inertiaVY = 0;

	let isPanning = false;
	let dragStartX = 0, dragStartY = 0;
	let startTargetX = 0, startTargetY = 0;
	let hasMoved = false;

	let imageDrag = null;
	let longPressTimer = 0;
	let arrangedCluster = null;
	let tapCandidate = null;

	const expandedSet = new Set();

	const io = new IntersectionObserver((entries)=>{
		for(const entry of entries){
			if(entry.isIntersecting){
				const img = entry.target;
				if(img.dataset && img.dataset.src && !img.src){ img.src = img.dataset.src; }
				io.unobserve(img);
			}
		}
	},{ root: null, rootMargin: '800px', threshold: 0.01 });

	function rand(min, max){ return Math.random() * (max - min) + min; }
	function keyFor(wx, wy){ return `${Math.floor(wx/GRID_SIZE)},${Math.floor(wy/GRID_SIZE)}`; }
	function occGet(wx, wy){ return occupancy.get(keyFor(wx,wy)) || 0; }
	function occInc(wx, wy){ const k = keyFor(wx,wy); occupancy.set(k, (occupancy.get(k)||0)+1); }

	function applyPan(){ canvas.style.transform = `translate(calc(-50% + ${viewX}px), calc(-50% + ${viewY}px))`; }
	function animate(){ if(!isPanning && !imageDrag){ targetX += inertiaVX; targetY += inertiaVY; inertiaVX *= FRICTION; inertiaVY *= FRICTION; if(Math.abs(inertiaVX) < 0.01) inertiaVX = 0; if(Math.abs(inertiaVY) < 0.01) inertiaVY = 0; } viewX += (targetX - viewX) * LERP; viewY += (targetY - viewY) * LERP; applyPan(); requestAnimationFrame(animate); }
	function recenter(){ targetX = 0; targetY = 0; inertiaVX = 0; inertiaVY = 0; }

	function downloadViaIframe(href){ const iframe = document.createElement('iframe'); iframe.style.display = 'none'; iframe.src = href; document.body.appendChild(iframe); setTimeout(()=>{ try{ iframe.remove(); } catch(_){} }, 2000); }

	function buildReverseSearchUrls(proxyUrl){
		try{
			const u = new URL(proxyUrl, window.location.origin);
			u.searchParams.delete('download');
			const original = u.searchParams.get('url') ? decodeURIComponent(u.searchParams.get('url')) : proxyUrl;
			return {
				lens: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(original)}&hl=en`,
				bing: `https://www.bing.com/images/search?q=imgurl:${encodeURIComponent(original)}&view=detailv2&iss=sbi&FORM=SBIVSP`,
				yandex: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(original)}`,
				tineye: `https://tineye.com/search?url=${encodeURIComponent(original)}`,
			};
		}catch(_){
			return { lens: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(proxyUrl)}&hl=en` };
		}
	}

	function createLens(){
		const el = document.createElement('button');
		el.type = 'button';
		el.className = 'lens';
		el.setAttribute('aria-label', 'Reverse image search');
		const svgNS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(svgNS, 'svg');
		svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('width','16'); svg.setAttribute('height','16');
		const path = document.createElementNS(svgNS, 'path'); path.setAttribute('fill','currentColor'); path.setAttribute('d','M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'); svg.appendChild(path);
		el.appendChild(svg);
		el.addEventListener('pointerdown', (ev)=>{ ev.stopPropagation(); });
		el.addEventListener('pointerup', (ev)=>{ ev.stopPropagation(); });
		return el;
	}

	function createArt(url){
		const container = document.createElement('div'); container.className = 'art';
		const img = document.createElement('img'); img.className = 'art-img'; img.loading = 'lazy'; img.alt = 'inspiration'; img.decoding = 'async'; img.dataset.src = url; img.addEventListener('load', ()=>{ img.classList.add('ready'); }); img.style.width = `${rand(16, 26).toFixed(2)}vw`; io.observe(img);
		const dl = document.createElement('a'); dl.className = 'dl'; dl.textContent = 'download'; dl.href = appendParam(url, 'download', '1'); dl.setAttribute('download', ''); dl.addEventListener('pointerdown', (ev)=>{ ev.stopPropagation(); }); dl.addEventListener('click', (ev)=>{ ev.stopPropagation(); ev.preventDefault(); downloadViaIframe(dl.href); });
		const lens = createLens(); lens.addEventListener('click', (ev)=>{ ev.stopPropagation(); const urls = buildReverseSearchUrls(url); window.open(urls.lens, '_blank', 'noopener,noreferrer'); });
		container.appendChild(img); container.appendChild(dl); container.appendChild(lens);
		return container;
	}

	function appendParam(url, key, val){ try{ const u = new URL(url, window.location.origin); u.searchParams.set(key, val); return u.toString(); } catch(_) { return url; } }

	function placeImage(url){ if(used.has(url)) return; let attempts = 6; let wx = 0, wy = 0; while(attempts--){ const bias = 0.55; const cx = -targetX, cy = -targetY; wx = rand(-0.5*worldWidth, 0.5*worldWidth) * bias + cx*(1-bias) + rand(-600,600); wy = rand(-0.5*worldHeight,0.5*worldHeight) * bias + cy*(1-bias) + rand(-600,600); if(occGet(wx, wy) < MAX_PER_CELL) break; } if(occGet(wx, wy) >= MAX_PER_CELL) return; used.add(url); occInc(wx, wy); const art = createArt(url); art.dataset.wx = String(wx); art.dataset.wy = String(wy); art.dataset.src = url; art.style.left = `calc(50% + ${wx}px)`; art.style.top = `calc(50% + ${wy}px)`; canvas.appendChild(art); }

	async function loadMore(){ if(loadingBatch) return; loadingBatch = true; loading.style.display = 'block'; try{ const res = await API.list(72); let urls = res.images || []; urls = urls.map(u => (u.startsWith('http://') || u.startsWith('https://')) ? u : `${API_BASE}${u}`); if(urls.length){ worldWidth *= 1.05; worldHeight *= 1.05; canvas.style.width = `${worldWidth}px`; canvas.style.height = `${worldHeight}px`; let placed = 0; for(const u of urls){ placeImage(u); if(++placed >= MAX_PER_BATCH) break; } } } finally { loadingBatch = false; loading.style.display = 'none'; } }

	function onWheel(e){ const factor = 0.9; inertiaVX -= (e.shiftKey ? e.deltaY : e.deltaX) * factor * 0.02; inertiaVY -= e.deltaY * factor * 0.02; }
	function startPan(e){ isPanning = true; hasMoved = false; document.body.classList.add('panning'); dragStartX = e.clientX; dragStartY = e.clientY; startTargetX = targetX; startTargetY = targetY; inertiaVX = 0; inertiaVY = 0; stage.setPointerCapture(e.pointerId); }
	function movePan(e){ if(!isPanning || imageDrag) return; const dx = e.clientX - dragStartX; const dy = e.clientY - dragStartY; if(Math.abs(dx) > PAN_CANCEL_PX || Math.abs(dy) > PAN_CANCEL_PX){ hasMoved = true; tapCandidate = null; } targetX = startTargetX + dx; targetY = startTargetY + dy; inertiaVX = dx * 0.08; inertiaVY = dy * 0.08; }
	function endPan(e){ isPanning = false; document.body.classList.remove('panning'); stage.releasePointerCapture(e.pointerId); }

	function onPointerDown(e){ const target = e.target; if(target.closest && (target.closest('.lens') || target.closest('.dl'))){ return; } if(target && target.closest){ const art = target.closest('.art'); tapCandidate = art || null; clearTimeout(longPressTimer); if(art){ longPressTimer = setTimeout(()=>{ beginImageHold(art, e); tapCandidate = null; }, LONG_PRESS_MS); } } startPan(e); }
	function onPointerMove(e){ if(Math.abs(e.clientX - dragStartX) > PAN_CANCEL_PX || Math.abs(e.clientY - dragStartY) > PAN_CANCEL_PX){ clearTimeout(longPressTimer); } if(imageDrag){ updateImageDrag(e); return; } movePan(e); }
	function onPointerUp(e){ clearTimeout(longPressTimer); if(imageDrag){ endImageDrag(e); return; } if(!hasMoved && tapCandidate){ toggleExpand(tapCandidate); } tapCandidate = null; endPan(e); }

	function beginImageHold(art, e){ imageDrag = { el: art, startWX: parseFloat(art.dataset.wx||'0'), startWY: parseFloat(art.dataset.wy||'0') }; art.classList.add('topmost'); arrangeClusterAround(art, true); }
	function updateImageDrag(e){ const art = imageDrag.el; const dx = e.clientX - dragStartX; const dy = e.clientY - dragStartY; const wx = imageDrag.startWX + dx; const wy = imageDrag.startWY + dy; art.dataset.wx = String(wx); art.dataset.wy = String(wy); art.style.left = `calc(50% + ${wx}px)`; art.style.top = `calc(50% + ${wy}px)`; if(arrangedCluster){ positionClusterGrid(arrangedCluster, {wx, wy}); pushOthersAway({wx, wy}); } }
	function endImageDrag(e){ const art = imageDrag.el; imageDrag = null; if(arrangedCluster){ for(const it of arrangedCluster.items){ const left = parseFloat(it.el.style.left.replace('calc(50% + ','').replace('px)',''))||parseFloat(it.el.dataset.wx||'0'); const top = parseFloat(it.el.style.top.replace('calc(50% + ','').replace('px)',''))||parseFloat(it.el.dataset.wy||'0'); it.el.dataset.wx = String(left); it.el.dataset.wy = String(top); } arrangedCluster = null; } }

	function getAllArts(){ return Array.from(canvas.querySelectorAll('.art')); }
	function distance(ax, ay, bx, by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx,dy); }

	function arrangeClusterAround(centerEl, push){ const cx = parseFloat(centerEl.dataset.wx||'0'); const cy = parseFloat(centerEl.dataset.wy||'0'); const arts = getAllArts(); const neighbors = []; for(const el of arts){ if(el === centerEl) continue; const wx = parseFloat(el.dataset.wx||'0'); const wy = parseFloat(el.dataset.wy||'0'); if(distance(cx,cy,wx,wy) <= GRID_CLUSTER_RADIUS){ neighbors.push({el, wx, wy}); if(neighbors.length >= GRID_CLUSTER_MAX) break; } } const cluster = { center: centerEl, items: neighbors }; const count = neighbors.length; if(count === 0){ arrangedCluster = cluster; return; } const cols = Math.ceil(Math.sqrt(count)); const rows = Math.ceil(count / cols); const size = 220; cluster.grid = { cols, rows, size }; positionClusterGrid(cluster, { wx: cx, wy: cy }); arrangedCluster = cluster; if(push) pushOthersAway({ wx: cx, wy: cy }); }

	function positionClusterGrid(cluster, center){ const { cols, rows, size } = cluster.grid; const gap = GRID_GAP; const halfW = (cols-1) * (size + gap) * 0.5; const halfH = (rows-1) * (size + gap) * 0.5; for(let i=0;i<cluster.items.length;i++){ const it = cluster.items[i]; const col = i % cols; const row = Math.floor(i / cols); const wx = center.wx + col*(size+gap) - halfW; const wy = center.wy + row*(size+gap) - halfH; it.el.style.left = `calc(50% + ${wx}px)`; it.el.style.top = `calc(50% + ${wy}px)`; } }

	function pushOthersAway(center){ const arts = getAllArts(); for(const el of arts){ if(arrangedCluster && (el === arrangedCluster.center || arrangedCluster.items.some(it=>it.el===el))) continue; const wx = parseFloat(el.dataset.wx||'0'); const wy = parseFloat(el.dataset.wy||'0'); const d = distance(center.wx, center.wy, wx, wy); if(d < GRID_CLUSTER_RADIUS * 1.2){ const angle = Math.atan2(wy - center.wy, wx - center.wx); const dist = GRID_CLUSTER_RADIUS * 1.35 - d; const nx = wx + Math.cos(angle) * dist; const ny = wy + Math.sin(angle) * dist; el.style.left = `calc(50% + ${nx}px)`; el.style.top = `calc(50% + ${ny}px)`; el.dataset.wx = String(nx); el.dataset.wy = String(ny); } } }

	function toggleExpand(art){ if(expandedSet.has(art)){ art.classList.remove('expanded'); expandedSet.delete(art); updateTray(); return; } expandLayoutAround(art); art.classList.add('expanded'); expandedSet.add(art); art.classList.add('topmost'); updateTray(); }

	function expandLayoutAround(art){ const ax = parseFloat(art.dataset.wx||'0'); const ay = parseFloat(art.dataset.wy||'0'); const arts = getAllArts(); let ringIndex = 0; for(const el of arts){ if(el === art) continue; const ex = parseFloat(el.dataset.wx||'0'); const ey = parseFloat(el.dataset.wy||'0'); const d = distance(ax, ay, ex, ey); if(d < EXPAND_RADIUS){ const angle = Math.atan2(ey - ay, ex - ax); const radius = EXPAND_RADIUS + (ringIndex % 2) * (EXPAND_GAP*6); const nx = ax + Math.cos(angle) * radius; const ny = ay + Math.sin(angle) * radius; el.style.left = `calc(50% + ${nx}px)`; el.style.top = `calc(50% + ${ny}px)`; el.dataset.wx = String(nx); el.dataset.wy = String(ny); ringIndex++; } } }

	function updateTray(){ trayItems.innerHTML = ''; if(expandedSet.size === 0){ tray.hidden = true; return; } tray.hidden = false; for(const art of expandedSet){ const item = document.createElement('div'); item.className = 'tray-item'; const img = art.querySelector('img.art-img'); const thumb = document.createElement('img'); thumb.src = img.src || img.dataset.src || ''; item.appendChild(thumb); item.addEventListener('click', ()=>{ const wx = parseFloat(art.dataset.wx||'0'); const wy = parseFloat(art.dataset.wy||'0'); targetX = -wx; targetY = -wy; inertiaVX = 0; inertiaVY = 0; art.classList.add('topmost'); }); trayItems.appendChild(item); } }

	function showEscHint(){ const node = document.getElementById('hint'); if(!node) return; node.textContent = 'esc to shrink'; node.style.animation = 'none'; void node.offsetWidth; node.style.animation = ''; }

	function collapseExpanded(){ if(expandedSet.size === 0) return; for(const art of expandedSet){ art.classList.remove('expanded'); } expandedSet.clear(); updateTray(); }
	window.addEventListener('keydown', (e)=>{ if(e.key === 'Escape'){ collapseExpanded(); } });

	recenterBtn.addEventListener('click', recenter);
	stage.addEventListener('wheel', onWheel, { passive: true });
	stage.addEventListener('pointerdown', onPointerDown);
	stage.addEventListener('pointermove', onPointerMove);
	stage.addEventListener('pointerup', onPointerUp);
	stage.addEventListener('pointercancel', onPointerUp);

	canvas.style.width = `${worldWidth}px`; canvas.style.height = `${worldHeight}px`;
	applyPan(); requestAnimationFrame(animate);
	loadMore(); setInterval(()=>{ if(!loadingBatch) loadMore(); }, 10000);
})();
