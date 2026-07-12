/* =====================================================================
   UI Platform — runtime partagé OI + PC-Tac. Classic script (pas de module)
   pour fonctionner dans les deux apps. Expose window.UIPlatform.
   Purement additif : n'altère aucun comportement existant tant qu'il n'est
   pas explicitement appelé. Auto-init léger sur DOMContentLoaded (safe-area
   + suivi du clavier virtuel uniquement).
   ===================================================================== */
(function () {
    'use strict';
    if (window.UIPlatform) return; // idempotent

    /* ---------- Échappement HTML (T#4 transverse) ---------- */
    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function escAttr(value) { return esc(value); }

    /* ---------- Persistance d'état UI (T17) ---------- */
    function loadState(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            try { return JSON.parse(raw); } catch (e) { return raw; }
        } catch (e) { return fallback; }
    }
    function saveState(key, value) {
        try {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('[UIPlatform] saveState échec', key, e && e.name);
            return false;
        }
    }
    /** Lit au boot (applier) ET renvoie un setter qui persiste à chaque changement. */
    function persistState(key, applier, fallback) {
        const initial = loadState(key, fallback);
        try { if (typeof applier === 'function') applier(initial); } catch (e) { /* non bloquant */ }
        return function (value) { saveState(key, value); };
    }

    /* ---------- Verrou de scroll réf-compté (T3) ---------- */
    let _scrollLockCount = 0;
    let _savedScrollY = 0;
    function lockScroll() {
        _scrollLockCount++;
        if (_scrollLockCount > 1) return;
        _savedScrollY = window.scrollY || window.pageYOffset || 0;
        document.body.style.top = '-' + _savedScrollY + 'px';
        document.body.classList.add('up-scroll-locked');
    }
    function unlockScroll(force) {
        if (force) _scrollLockCount = 0;
        else _scrollLockCount = Math.max(0, _scrollLockCount - 1);
        if (_scrollLockCount > 0) return;
        document.body.classList.remove('up-scroll-locked');
        document.body.style.top = '';
        window.scrollTo(0, _savedScrollY);
    }

    /* ---------- Recadrage popover dans le viewport (T8) ---------- */
    function clampToViewport(el, margin) {
        if (!el) return;
        margin = margin == null ? 8 : margin;
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        let dx = 0, dy = 0;
        if (r.right > vw - margin) dx = (vw - margin) - r.right;
        if (r.left + dx < margin) dx = margin - r.left;
        if (r.bottom > vh - margin) dy = (vh - margin) - r.bottom;
        if (r.top + dy < margin) dy = margin - r.top;
        if (dx || dy) {
            const prev = el.style.transform || '';
            el.style.transform = prev + ' translate(' + Math.round(dx) + 'px,' + Math.round(dy) + 'px)';
        }
    }

    /* ---------- Gestes (T7) ---------- */
    function onLongPress(el, cb, opts) {
        opts = opts || {};
        const delay = opts.delay || 450;
        const moveTol = opts.moveTol || 10;
        let timer = null, sx = 0, sy = 0, fired = false;
        function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
        el.addEventListener('pointerdown', function (e) {
            fired = false; sx = e.clientX; sy = e.clientY;
            cancel();
            timer = setTimeout(function () { fired = true; cb(e); }, delay);
        });
        el.addEventListener('pointermove', function (e) {
            if (timer && (Math.abs(e.clientX - sx) > moveTol || Math.abs(e.clientY - sy) > moveTol)) cancel();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
            el.addEventListener(ev, cancel);
        });
        return { isFired: function () { return fired; } };
    }
    function onDoubleTap(el, cb, opts) {
        opts = opts || {};
        const win = opts.window || 320;
        let last = 0, lx = 0, ly = 0;
        el.addEventListener('pointerup', function (e) {
            const now = (e.timeStamp || performance.now());
            if (now - last < win && Math.abs(e.clientX - lx) < 24 && Math.abs(e.clientY - ly) < 24) {
                last = 0; cb(e);
            } else { last = now; lx = e.clientX; ly = e.clientY; }
        });
    }

    /* ---------- Tri tactile unifié (T6) — Pointer Events ----------
       sortable(container, {
         itemSelector, handleSelector?, longPress?(ms|false), threshold?, onReorder(orderedEls, fromIdx, toIdx)
       }) → { destroy() }
       Souris + tactile + stylet d'un seul code. Sous le seuil/délai, le scroll
       de la liste reste possible. touch-action:none uniquement pendant le drag. */
    function sortable(container, opts) {
        opts = opts || {};
        const itemSelector = opts.itemSelector || ':scope > *';
        const handleSel = opts.handleSelector || null;
        const longPressMs = opts.longPress === undefined ? 0 : opts.longPress;
        const threshold = opts.threshold == null ? 8 : opts.threshold;
        const axis = opts.axis === 'x' ? 'x' : 'y'; // 'y' = liste verticale (défaut), 'x' = horizontale
        let active = null, placeholder = null, startY = 0, startX = 0, lpTimer = null, armed = false, pointerId = null;

        function items() { return Array.prototype.slice.call(container.querySelectorAll(itemSelector)); }
        function cleanup() {
            if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            if (active) {
                active.classList.remove('up-sort-dragging');
                active.style.transform = '';
                active.style.position = '';
                active.style.width = '';
                active.style.pointerEvents = '';
            }
            if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
            container.classList.remove('up-sorting');
            active = null; placeholder = null; armed = false; pointerId = null;
        }
        function begin(item, e) {
            armed = true;
            active = item;
            const r = item.getBoundingClientRect();
            placeholder = document.createElement(item.tagName);
            placeholder.className = 'up-sort-placeholder';
            placeholder.style.height = r.height + 'px';
            item.parentNode.insertBefore(placeholder, item.nextSibling);
            item.classList.add('up-sort-dragging');
            item.style.width = r.width + 'px';
            container.classList.add('up-sorting');
            try { item.setPointerCapture(pointerId); } catch (_) {}
            moveTo(e.clientX, e.clientY);
        }
        function moveTo(clientX, clientY) {
            if (!active) return;
            active.style.transform = (axis === 'x')
                ? 'translateX(' + (clientX - startX) + 'px)'
                : 'translateY(' + (clientY - startY) + 'px)';
            const sibs = items().filter(function (el) { return el !== active && el !== placeholder; });
            let placed = false;
            for (let i = 0; i < sibs.length; i++) {
                const r = sibs[i].getBoundingClientRect();
                const pos = (axis === 'x') ? clientX : clientY;
                const mid = (axis === 'x') ? (r.left + r.width / 2) : (r.top + r.height / 2);
                if (pos < mid) {
                    container.insertBefore(placeholder, sibs[i]); placed = true; break;
                }
            }
            if (!placed) container.appendChild(placeholder);
        }
        function onDown(e) {
            if (e.button != null && e.button !== 0) return;
            // Filtre optionnel par type de pointeur (ex. ['touch'] pour laisser la
            // souris au drag&drop HTML5 natif sur desktop).
            if (opts.pointerTypes && opts.pointerTypes.indexOf(e.pointerType) === -1) return;
            const item = e.target.closest ? e.target.closest(itemSelector) : null;
            if (!item || item.parentNode !== container) return;
            if (handleSel && !(e.target.closest && e.target.closest(handleSel))) return;
            pointerId = e.pointerId; startY = e.clientY; startX = e.clientX;
            if (longPressMs) {
                lpTimer = setTimeout(function () { begin(item, e); }, longPressMs);
            } else {
                container.__pendingItem = item; // démarre au seuil de déplacement
            }
        }
        function onMove(e) {
            if (e.pointerId !== pointerId && pointerId !== null) return;
            if (armed) { e.preventDefault(); moveTo(e.clientX, e.clientY); return; }
            if (lpTimer && (Math.abs(e.clientY - startY) > threshold || Math.abs(e.clientX - startX) > threshold)) {
                clearTimeout(lpTimer); lpTimer = null; // mouvement avant long-press = scroll
            }
            const primaryDelta = (axis === 'x') ? Math.abs(e.clientX - startX) : Math.abs(e.clientY - startY);
            if (!longPressMs && container.__pendingItem && primaryDelta > threshold) {
                const it = container.__pendingItem; container.__pendingItem = null;
                begin(it, e);
            }
        }
        function onUp(e) {
            container.__pendingItem = null;
            if (armed && active && placeholder) {
                const ordered = items().filter(function (el) { return el !== active; });
                const toIdx = ordered.indexOf(placeholder);
                placeholder.parentNode.insertBefore(active, placeholder);
                cleanup();
                if (typeof opts.onReorder === 'function') {
                    opts.onReorder(items(), toIdx);
                }
            } else {
                cleanup();
            }
        }
        container.addEventListener('pointerdown', onDown);
        container.addEventListener('pointermove', onMove);
        container.addEventListener('pointerup', onUp);
        container.addEventListener('pointercancel', cleanup);
        return { destroy: function () {
            container.removeEventListener('pointerdown', onDown);
            container.removeEventListener('pointermove', onMove);
            container.removeEventListener('pointerup', onUp);
            container.removeEventListener('pointercancel', cleanup);
            cleanup();
        } };
    }

    /* ---------- Modale accessible (T13/T3/T4) ---------- */
    function getFocusable(root) {
        return Array.prototype.slice.call(root.querySelectorAll(
            'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    }
    function makeDialog(el, opts) {
        opts = opts || {};
        el.setAttribute('role', el.getAttribute('role') || 'dialog');
        el.setAttribute('aria-modal', 'true');
        let lastFocus = null;
        function onKey(e) {
            if (e.key === 'Escape' && opts.onClose) { opts.onClose(e); return; }
            if (e.key !== 'Tab') return;
            const f = getFocusable(el);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        return {
            open: function () {
                lastFocus = document.activeElement;
                el.classList.add('up-kb-aware');
                lockScroll();
                el.addEventListener('keydown', onKey);
                const f = getFocusable(el);
                if (f.length) f[0].focus();
            },
            close: function () {
                el.removeEventListener('keydown', onKey);
                unlockScroll();
                if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) {} }
            }
        };
    }

    /* ---------- Onglets accessibles (T13) ---------- */
    function makeTablist(container, opts) {
        opts = opts || {};
        const tabSel = opts.tabSelector || '[role="tab"]';
        container.setAttribute('role', 'tablist');
        function tabs() { return Array.prototype.slice.call(container.querySelectorAll(tabSel)); }
        container.addEventListener('keydown', function (e) {
            const t = tabs(); const i = t.indexOf(document.activeElement);
            if (i < 0) return;
            let n = -1;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % t.length;
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + t.length) % t.length;
            else if (e.key === 'Home') n = 0;
            else if (e.key === 'End') n = t.length - 1;
            if (n >= 0) { e.preventDefault(); t[n].focus(); if (opts.activate) opts.activate(t[n]); }
        });
    }

    /* ---------- Suivi du clavier virtuel (T4) ---------- */
    function initKeyboardTracking() {
        const vv = window.visualViewport;
        if (!vv) return;
        function update() {
            const inset = Math.max(0, (window.innerHeight - vv.height - vv.offsetTop));
            document.documentElement.style.setProperty('--kb-inset', inset + 'px');
            document.body.classList.toggle('up-kb-open', inset > 80);
        }
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        update();
    }

    function init() {
        // viewport-fit=cover si absent (active la safe-area)
        const vp = document.querySelector('meta[name="viewport"]');
        if (vp && !/viewport-fit/.test(vp.content)) {
            vp.content = vp.content + ', viewport-fit=cover';
        }
        initKeyboardTracking();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.UIPlatform = {
        esc: esc, escAttr: escAttr,
        loadState: loadState, saveState: saveState, persistState: persistState,
        lockScroll: lockScroll, unlockScroll: unlockScroll,
        clampToViewport: clampToViewport,
        onLongPress: onLongPress, onDoubleTap: onDoubleTap,
        sortable: sortable,
        makeDialog: makeDialog, makeTablist: makeTablist
    };
})();
