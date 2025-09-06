// Simple cross-session memory for last activity and resume UX
// - Records last visited path and timestamp
// - Shows a small "Resume" banner on home if last page was a game

function saveLastVisit() {
  try {
    const url = location.pathname + location.search + location.hash;
    localStorage.setItem('last.visit.url', url);
    localStorage.setItem('last.visit.time', String(Date.now()));
    // Derive game key from path like /games/shell/index.html
    const m = location.pathname.match(/\/games\/([^\/]+)\//);
    if (m && m[1]) localStorage.setItem('last.visit.game', m[1]);
  } catch {}
}

function humanAgo(ts) {
  const d = Date.now() - Number(ts || 0);
  if (!isFinite(d) || d < 0) return '';
  const s = Math.floor(d/1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s/60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h/24);
  return `${days}d ago`;
}

function showResumeOnHome() {
  try {
    if (!document.body.classList.contains('home')) return;
    const lastUrl = localStorage.getItem('last.visit.url') || '';
    const lastGame = localStorage.getItem('last.visit.game') || '';
    const lastTime = localStorage.getItem('last.visit.time') || '';
    if (!lastUrl || lastUrl.includes('/index.html')) return;

    // Only show for game pages or other app pages, not the same home
    const label = lastGame ? (lastGame.charAt(0).toUpperCase() + lastGame.slice(1)) : 'last page';

    // Create a compact banner just under the top banner
    let host = document.querySelector('.tavern') || document.body;
    let bar = document.getElementById('resume-banner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'resume-banner';
      bar.style.cssText = [
        'margin: 8px auto', 'padding: 8px 12px', 'max-width: 900px',
        'display:flex','align-items:center','justify-content:space-between', 'gap:8px',
        'font-size:13px','color:#2b1e12', 'background:rgba(0,0,0,0.06)', 'border-radius:8px'
      ].join(';');
      if (host.firstChild) host.insertBefore(bar, host.firstChild); else host.appendChild(bar);
    }
    bar.innerHTML = '';
    const left = document.createElement('div');
    left.innerHTML = `<strong>Resume:</strong> Continue where you left off (${label}) <span style="opacity:.65;">${humanAgo(lastTime)}</span>`;
    const right = document.createElement('div');
    const resume = document.createElement('button');
    resume.textContent = 'Resume';
    resume.style.cssText = 'padding:4px 8px;border-radius:6px;cursor:pointer;';
    resume.onclick = () => { try { location.href = lastUrl; } catch {} };
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    dismiss.style.cssText = 'margin-left:8px;padding:4px 8px;border-radius:6px;cursor:pointer;';
    dismiss.onclick = () => { try { bar.remove(); } catch {} };
    right.appendChild(resume); right.appendChild(dismiss);
    bar.appendChild(left); bar.appendChild(right);
  } catch {}
}

// Save visit on every page and attempt showing resume on home
try { saveLastVisit(); } catch {}
try { window.addEventListener('DOMContentLoaded', showResumeOnHome); } catch {}

export {}; // module boundary

