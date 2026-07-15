'use strict';

// ── Config ──────────────────────────────────────────────────────────────────
const API = 'http://localhost:3000/api/v1';

// ── State ───────────────────────────────────────────────────────────────────
let state = {
  token:     localStorage.getItem('token') ?? null,
  user:      JSON.parse(localStorage.getItem('user') ?? 'null'),
  cart:      [],
  cartCount: 0,
};

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function api(method, path, body, authed = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (authed && state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message ?? data.message ?? (typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return data.data ?? data;
}

const get    = (path, authed)    => api('GET',    path, null, authed);
const post   = (path, body)      => api('POST',   path, body);
const patch  = (path, body)      => api('PATCH',  path, body);
const del    = (path)            => api('DELETE', path);

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Number format ────────────────────────────────────────────────────────────
const won = (n) => n?.toLocaleString('ko-KR') + '원';

// ── Status chip ──────────────────────────────────────────────────────────────
function statusChip(s) {
  const map = {
    ACTIVE: 'green', APPROVED: 'green', COMPLETED: 'green', DELIVERED: 'green', SETTLED: 'green',
    PENDING: 'yellow', PENDING_APPROVAL: 'yellow', PREPARING: 'yellow', PAYMENT_PENDING: 'yellow',
    REJECTED: 'red', CANCELLED: 'red', FAILED: 'red',
    SHIPPED: 'blue', IN_TRANSIT: 'blue', PAID: 'blue', CONFIRMED: 'blue',
    INACTIVE: 'gray', DRAFT: 'gray',
  };
  const cls = map[s] ?? 'gray';
  return `<span class="chip chip-${cls}">${s}</span>`;
}

// ── Placeholder image for demo ───────────────────────────────────────────────
const EMOJI_MAP = {
  '전자제품': '📱', '의류': '👗', '식품': '🥜',
};
function productEmoji(categoryName) {
  return EMOJI_MAP[categoryName] ?? '📦';
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function saveAuth(token, user) {
  state.token = token;
  state.user  = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  updateNav();
}

function logout() {
  state.token = null;
  state.user  = null;
  state.cart  = [];
  state.cartCount = 0;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  updateNav();
  navigate('/');
  toast('로그아웃되었습니다.', 'success');
}

function isLoggedIn()  { return !!state.token; }
function isRole(...rs) { return rs.includes(state.user?.role); }

// ── Cart badge helper ─────────────────────────────────────────────────────────
async function refreshCartBadge() {
  if (!isLoggedIn()) { document.getElementById('cart-badge').textContent = '0'; return; }
  try {
    const d = await get('/cart');
    state.cartCount = d.count ?? 0;
    document.getElementById('cart-badge').textContent = state.cartCount;
  } catch (_) {}
}

// ── Nav ────────────────────────────────────────────────────────────────────────
function updateNav() {
  const loggedIn = isLoggedIn();
  document.getElementById('nav-login-btn').style.display  = loggedIn ? 'none' : '';
  document.getElementById('nav-logout-btn').style.display = loggedIn ? '' : 'none';
  document.getElementById('nav-user').style.display       = loggedIn ? '' : 'none';
  document.getElementById('nav-cart').style.display       = loggedIn ? '' : 'none';
  document.getElementById('nav-orders').style.display     = loggedIn ? '' : 'none';
  document.getElementById('nav-agent').style.display      = isRole('agent') ? '' : 'none';
  document.getElementById('nav-admin').style.display      = isRole('admin','super-admin') ? '' : 'none';
  if (loggedIn) {
    document.getElementById('nav-user').textContent = `${state.user.firstName} ${state.user.lastName} (${state.user.role})`;
    refreshCartBadge();
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {};
function registerRoute(path, fn) { routes[path] = fn; }

function navigate(path) {
  location.hash = '#' + path;
}

async function router() {
  const hash = location.hash.slice(1) || '/';
  const [base, ...rest] = hash.split('/').filter(Boolean);
  const routeKey = base ? '/' + base : '/';

  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">로딩 중...</div>';

  try {
    const fn = routes[routeKey];
    if (fn) {
      await fn(rest);
    } else {
      app.innerHTML = '<div class="container empty"><div class="empty-icon">🔍</div><p>페이지를 찾을 수 없습니다.</p></div>';
    }
  } catch (err) {
    app.innerHTML = `<div class="container"><div class="alert alert-warning">오류: ${err.message}</div></div>`;
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('load', () => { updateNav(); router(); });

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Home — Product Listing
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/', async () => {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container">
      <div class="row mb-2">
        <h1 class="page-title" style="margin:0;flex:1">전체 상품</h1>
        <select id="filter-category" class="form-select" style="width:160px" onchange="applyFilter()">
          <option value="">전체 카테고리</option>
          <option value="electronics">전자제품</option>
          <option value="clothing">의류</option>
          <option value="food">식품</option>
        </select>
        <select id="filter-sort" class="form-select" style="width:140px" onchange="applyFilter()">
          <option value="createdAt:desc">최신순</option>
          <option value="price:asc">낮은가격순</option>
          <option value="price:desc">높은가격순</option>
        </select>
      </div>
      <div id="product-grid" class="product-grid"><div class="loading">상품을 불러오는 중...</div></div>
      <div id="pagination" class="row mt-3" style="justify-content:center"></div>
    </div>`;

  window.applyFilter = () => loadProducts(1);
  await loadProducts(1);
});

async function loadProducts(page = 1) {
  const catSlug = document.getElementById('filter-category')?.value ?? '';
  const [sortBy, sortOrder] = (document.getElementById('filter-sort')?.value ?? 'createdAt:desc').split(':');

  const params = new URLSearchParams({ page, limit: 12, sortBy, sortOrder });
  if (catSlug) params.set('categorySlug', catSlug);

  const data = await get(`/products?${params}`, false);
  renderProductGrid(data.items ?? [], data.total ?? 0, page, data.totalPages ?? 1);
}

function renderProductGrid(products, total, page, totalPages) {
  const grid = document.getElementById('product-grid');
  if (!products.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📭</div><p>상품이 없습니다.</p></div>';
    return;
  }
  grid.innerHTML = products.map(p => `
    <div class="product-card" onclick="navigate('/products/${p._id}')">
      <div class="product-card-img">
        ${p.images?.[0]
          ? `<img src="${p.images[0]}" alt="${p.name}" onerror="this.parentNode.innerHTML='📦'">`
          : productEmoji(p.categoryName)}
      </div>
      <div class="product-card-body">
        <div class="product-card-name">${p.name}</div>
        <div class="product-card-agent">판매: ${p.agentName ?? ''}</div>
        <div>
          <span class="product-card-price">${won(p.price)}</span>
          ${p.comparePrice ? `<span class="product-card-compare">${won(p.comparePrice)}</span>` : ''}
        </div>
        <div class="product-card-stock">${p.stock > 0 ? `재고 ${p.stock}개` : '<span style="color:#ef4444">품절</span>'}</div>
      </div>
    </div>`).join('');

  // Pagination
  const pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }
  let btns = '';
  for (let i = 1; i <= totalPages; i++) {
    btns += `<button class="btn btn-sm ${i === page ? 'btn-primary' : 'btn-outline'}" onclick="loadProducts(${i})">${i}</button>`;
  }
  pag.innerHTML = btns;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Product Detail
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/products', async ([id]) => {
  if (!id) { navigate('/'); return; }
  const app = document.getElementById('app');
  const p = await get(`/products/${id}`, false);

  let qty = 1;
  app.innerHTML = `
    <div class="container">
      <div class="mb-2"><a onclick="history.back()" style="cursor:pointer;color:#4f46e5">← 뒤로</a></div>
      <div class="product-detail">
        <div class="product-detail-img">
          ${p.images?.[0]
            ? `<img src="${p.images[0]}" alt="${p.name}" onerror="this.innerHTML='📦'">`
            : productEmoji(p.categoryName)}
        </div>
        <div class="product-detail-info">
          <div class="product-detail-category">${p.categoryName ?? ''}</div>
          <h1 class="product-detail-name">${p.name}</h1>
          <div>
            <span class="product-detail-price">${won(p.price)}</span>
            ${p.comparePrice ? `<span class="product-detail-compare">${won(p.comparePrice)}</span>` : ''}
          </div>
          <p class="product-detail-desc">${p.description ?? ''}</p>
          <div class="text-muted">판매자: ${p.agentName ?? ''}</div>
          <div class="text-muted">재고: ${p.stock > 0 ? p.stock + '개' : '<span style="color:#ef4444">품절</span>'}</div>
          ${p.stock > 0 ? `
          <div class="qty-control">
            <button class="qty-btn" onclick="setQty(${id}, ${JSON.stringify(p)}, -1)">−</button>
            <span class="qty-display" id="qty-display">1</span>
            <button class="qty-btn" onclick="setQty(${id}, ${JSON.stringify(p)}, 1)">+</button>
          </div>
          <button class="btn btn-primary btn-block" onclick="addToCart(${JSON.stringify(p)})">장바구니 담기</button>
          ` : '<button class="btn btn-block" disabled style="background:#e5e7eb;color:#9ca3af">품절</button>'}
        </div>
      </div>
    </div>`;

  // Qty controls
  window.setQty = (_id, prod, delta) => {
    qty = Math.max(1, Math.min(prod.stock, qty + delta));
    document.getElementById('qty-display').textContent = qty;
  };

  window.addToCart = async (prod) => {
    if (!isLoggedIn()) { navigate('/login'); toast('로그인이 필요합니다.', 'error'); return; }
    try {
      await post('/cart/items', {
        productId: prod._id,
        quantity: qty,
        unitPrice: prod.price,
        productName: prod.name,
        agentId: prod.agentId,
      });
      await refreshCartBadge();
      toast(`${prod.name} (${qty}개) 장바구니에 추가되었습니다!`);
    } catch (err) { toast(err.message, 'error'); }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Search
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/search', async () => {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container">
      <h1 class="page-title">상품 검색</h1>
      <div class="search-bar">
        <input id="search-input" class="form-input" placeholder="검색어를 입력하세요..." value="">
        <button class="btn btn-primary" onclick="doSearch()">검색</button>
      </div>
      <div id="search-results"></div>
    </div>`;

  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });

  window.doSearch = async () => {
    const q = document.getElementById('search-input').value.trim();
    if (!q) return;
    const results = document.getElementById('search-results');
    results.innerHTML = '<div class="loading">검색 중...</div>';
    try {
      const data = await get(`/search?q=${encodeURIComponent(q)}&limit=12`, false);
      const hits = data.hits ?? data.items ?? [];
      if (!hits.length) { results.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><p>검색 결과가 없습니다.</p></div>'; return; }
      results.innerHTML = `<div class="product-grid">${hits.map(p => `
        <div class="product-card" onclick="navigate('/products/${p._id ?? p.id}')">
          <div class="product-card-img">${p.images?.[0] ? `<img src="${p.images[0]}" onerror="this.parentNode.innerHTML='📦'">` : '📦'}</div>
          <div class="product-card-body">
            <div class="product-card-name">${p.name}</div>
            <div class="product-card-price">${won(p.price)}</div>
          </div>
        </div>`).join('')}</div>`;
    } catch (err) {
      results.innerHTML = `<div class="alert alert-warning">검색 서비스 오류: ${err.message}</div>`;
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Cart
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/cart', async () => {
  if (!isLoggedIn()) { navigate('/login'); return; }
  const app = document.getElementById('app');

  async function renderCart() {
    const data = await get('/cart');
    const items = data.items ?? [];
    const total = data.total ?? 0;

    if (!items.length) {
      app.innerHTML = `
        <div class="container">
          <h1 class="page-title">장바구니</h1>
          <div class="empty"><div class="empty-icon">🛒</div><p>장바구니가 비어있습니다.</p>
          <button class="btn btn-primary mt-2" onclick="navigate('/')">쇼핑 계속하기</button></div>
        </div>`;
      return;
    }

    app.innerHTML = `
      <div class="container">
        <h1 class="page-title">장바구니</h1>
        <div class="cart-layout">
          <div id="cart-items">
            ${items.map(item => `
              <div class="cart-item">
                <div class="cart-item-img">${item.images?.[0] ? `<img src="${item.images[0]}" onerror="this.parentNode.innerHTML='📦'">` : '📦'}</div>
                <div class="cart-item-info">
                  <div class="cart-item-name">${item.productName}</div>
                  <div class="cart-item-price">${won(item.unitPrice)} × ${item.quantity}개 = <strong>${won(item.unitPrice * item.quantity)}</strong></div>
                  <div class="row mt-1">
                    <button class="qty-btn" onclick="cartQty('${item.productId}', ${item.quantity - 1})">−</button>
                    <span>${item.quantity}</span>
                    <button class="qty-btn" onclick="cartQty('${item.productId}', ${item.quantity + 1})">+</button>
                    <button class="btn btn-sm btn-danger" onclick="cartRemove('${item.productId}')">삭제</button>
                  </div>
                </div>
              </div>`).join('')}
          </div>
          <div class="cart-summary">
            <div class="section-title">주문 요약</div>
            ${items.map(i => `
              <div class="summary-row"><span>${i.productName.slice(0,20)}...</span><span>${won(i.unitPrice * i.quantity)}</span></div>
            `).join('')}
            <div class="summary-row total"><span>합계</span><span class="price-fmt">${won(total)}</span></div>
            <button class="btn btn-primary btn-block mt-2" onclick="goCheckout()">주문하기</button>
            <button class="btn btn-outline btn-block mt-1" onclick="clearCart()">장바구니 비우기</button>
          </div>
        </div>
      </div>`;

    window.cartQty    = async (pid, q) => { try { await patch(`/cart/items/${pid}`, { quantity: q }); await renderCart(); await refreshCartBadge(); } catch (e) { toast(e.message,'error'); } };
    window.cartRemove = async (pid)    => { try { await del(`/cart/items/${pid}`); await renderCart(); await refreshCartBadge(); toast('삭제되었습니다.'); } catch (e) { toast(e.message,'error'); } };
    window.clearCart  = async ()       => { try { await del('/cart'); await renderCart(); await refreshCartBadge(); toast('장바구니를 비웠습니다.'); } catch (e) { toast(e.message,'error'); } };
    window.goCheckout = () => navigate('/checkout');
  }

  await renderCart();
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Checkout
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/checkout', async () => {
  if (!isLoggedIn()) { navigate('/login'); return; }
  const app = document.getElementById('app');

  const data  = await get('/cart');
  const items = data.items ?? [];
  if (!items.length) { navigate('/cart'); return; }
  const total = data.total ?? 0;

  app.innerHTML = `
    <div class="container">
      <h1 class="page-title">주문하기</h1>
      <div class="cart-layout">
        <div>
          <div class="section-title">배송 정보</div>
          <div class="form-group">
            <label class="form-label">수령인</label>
            <input id="o-name" class="form-input" placeholder="홍길동" value="${state.user?.firstName ?? ''} ${state.user?.lastName ?? ''}">
          </div>
          <div class="form-group">
            <label class="form-label">연락처</label>
            <input id="o-phone" class="form-input" placeholder="010-1234-5678" value="${state.user?.phone ?? ''}">
          </div>
          <div class="form-group">
            <label class="form-label">주소</label>
            <input id="o-addr" class="form-input" placeholder="서울시 강남구 테헤란로 123">
          </div>
          <div class="form-group">
            <label class="form-label">City</label>
            <input id="o-city" class="form-input" placeholder="Seoul">
          </div>
          <div class="form-group">
            <label class="form-label">상세주소</label>
            <input id="o-addr2" class="form-input" placeholder="101동 202호">
          </div>
          <div class="form-group">
            <label class="form-label">우편번호</label>
            <input id="o-zip" class="form-input" placeholder="06234" style="max-width:140px">
          </div>
          <div class="form-group">
            <label class="form-label">결제 방법</label>
            <select id="o-payment" class="form-select">
              <option value="CARD">신용카드</option>
              <option value="BANK_TRANSFER">계좌이체</option>
              <option value="VIRTUAL_ACCOUNT">가상계좌</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">주문 메모</label>
            <input id="o-note" class="form-input" placeholder="배송 시 메모 (선택)">
          </div>
          <div class="form-group">
            <label class="form-label">쿠폰 코드</label>
            <input id="o-coupon" class="form-input" maxlength="50" placeholder="WELCOME10 (선택)">
          </div>
          <button class="btn btn-primary btn-block" onclick="submitOrder()">결제하기</button>
        </div>
        <div class="cart-summary">
          <div class="section-title">주문 상품</div>
          ${items.map(i => `<div class="summary-row"><span>${i.productName.slice(0,18)}... ×${i.quantity}</span><span>${won(i.unitPrice * i.quantity)}</span></div>`).join('')}
          <div class="summary-row total"><span>합계</span><span class="price-fmt">${won(total)}</span></div>
        </div>
      </div>
    </div>`;

  window.submitOrder = async () => {
    const addr = {
      recipientName: document.getElementById('o-name').value.trim(),
      phone:         document.getElementById('o-phone').value.trim(),
      addressLine1:  document.getElementById('o-addr').value.trim(),
      addressLine2:  document.getElementById('o-addr2').value.trim() || undefined,
      city:          document.getElementById('o-city').value.trim(),
      postalCode:    document.getElementById('o-zip').value.trim(),
    };
    if (!addr.recipientName || !addr.addressLine1 || !addr.city || !addr.phone || !addr.postalCode) { toast('배송 정보를 모두 입력해주세요.', 'error'); return; }

    const orderItems = items.map(i => ({
      productId:   i.productId,
      agentId:     i.agentId,
      productName: i.productName,
      unitPrice:   i.unitPrice,
      quantity:    i.quantity,
    }));

    try {
      const idempotencyKey = `demo-${Date.now()}`;
      const couponCode = document.getElementById('o-coupon').value.trim();
      const order = await post('/orders', {
        items:           orderItems,
        shippingAddress: addr,
        ...(couponCode ? { couponCode } : {}),
        idempotencyKey,
      });
      let payableOrder = order;
      for (let attempt = 0; attempt < 20 && payableOrder.status !== 'PAYMENT_PENDING'; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
        payableOrder = await get(`/orders/${order.id}`);
        if (['CANCELLED', 'FAILED'].includes(payableOrder.status)) throw new Error('Order could not reserve inventory');
      }
      if (payableOrder.status !== 'PAYMENT_PENDING') throw new Error('Payment preparation timed out');
      await post('/payments', {
        orderId: order.id,
        method: document.getElementById('o-payment').value,
        idempotencyKey: `payment-${idempotencyKey}`,
      });
      await del('/cart');
      toast('주문이 완료되었습니다! 🎉');
      await refreshCartBadge();
      navigate('/orders');
    } catch (err) { toast(err.message, 'error'); }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: My Orders
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/orders', async () => {
  if (!isLoggedIn()) { navigate('/login'); return; }
  const app = document.getElementById('app');

  const data = await get('/orders');
  const orders = data.items ?? [];

  app.innerHTML = `
    <div class="container">
      <h1 class="page-title">내 주문 목록</h1>
      ${!orders.length
        ? '<div class="empty"><div class="empty-icon">📦</div><p>주문 내역이 없습니다.</p></div>'
        : orders.map(o => `
            <div class="order-card">
              <div class="order-header">
                <div>
                  <div class="order-id">${o.id}</div>
                  <div class="text-muted">${new Date(o.createdAt).toLocaleString('ko-KR')}</div>
                </div>
                ${statusChip(o.status)}
              </div>
              <ul class="order-items-list">
                ${(o.items ?? []).map(i => `<li>${i.productName} × ${i.quantity} — ${won(i.subtotal)}</li>`).join('')}
              </ul>
              <div class="order-total">합계 ${won(o.totalAmount)}</div>
              ${o.status === 'PENDING' || o.status === 'CONFIRMED'
                ? `<button class="btn btn-sm btn-danger mt-1" onclick="cancelOrder('${o.id}')">주문 취소</button>`
                : ''}
            </div>`).join('')}
    </div>`;

  window.cancelOrder = async (id) => {
    if (!confirm('정말 취소하시겠습니까?')) return;
    try { await patch(`/orders/${id}/cancel`); toast('주문이 취소되었습니다.'); navigate('/orders'); }
    catch (err) { toast(err.message, 'error'); }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Login
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/login', async () => {
  if (isLoggedIn()) { navigate('/'); return; }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="form-card">
      <div class="form-title">로그인</div>
      <div id="login-error" class="alert alert-warning mb-2" style="display:none"></div>
      <div class="form-group">
        <label class="form-label">이메일</label>
        <input id="login-email" class="form-input" type="email" placeholder="user1@demo.com" value="user1@demo.com">
      </div>
      <div class="form-group">
        <label class="form-label">비밀번호</label>
        <input id="login-pw" class="form-input" type="password" value="User1234!">
      </div>
      <button class="btn btn-primary btn-block" onclick="doLogin()">로그인</button>
      <div class="form-divider">또는</div>
      <button class="btn btn-outline btn-block" onclick="navigate('/register')">회원가입</button>
      <div class="mt-3" style="font-size:0.8rem;color:#9ca3af">
        <strong>데모 계정:</strong><br>
        관리자: admin@demo.com / Admin1234!<br>
        에이전트: agent1@demo.com / Agent1234!<br>
        사용자: user1@demo.com / User1234!
      </div>
    </div>`;

  window.doLogin = async () => {
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    try {
      const res = await post('/auth/login', {
        email:    document.getElementById('login-email').value,
        password: document.getElementById('login-pw').value,
      });
      saveAuth(res.accessToken, res.user);
      toast(`환영합니다, ${res.user.firstName}님!`);
      await refreshCartBadge();
      navigate('/');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  };

  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Enter') { doLogin(); document.removeEventListener('keydown', handler); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Register
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/register', async () => {
  if (isLoggedIn()) { navigate('/'); return; }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="form-card" style="max-width:520px">
      <div class="form-title">회원가입</div>
      <div id="reg-error" class="alert alert-warning mb-2" style="display:none"></div>

      <div class="tab-bar">
        <div class="tab active" id="tab-user" onclick="switchRole('user')">일반 회원</div>
        <div class="tab" id="tab-agent" onclick="switchRole('agent')">에이전트 (판매자)</div>
      </div>

      <div class="row mb-1">
        <div class="form-group" style="flex:1">
          <label class="form-label">성</label>
          <input id="reg-first" class="form-input" placeholder="홍">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">이름</label>
          <input id="reg-last" class="form-input" placeholder="길동">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">이메일</label>
        <input id="reg-email" class="form-input" type="email" placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label class="form-label">비밀번호</label>
        <input id="reg-pw" class="form-input" type="password" placeholder="최소 8자, 영문+숫자+특수문자">
      </div>
      <div class="form-group">
        <label class="form-label">전화번호</label>
        <input id="reg-phone" class="form-input" placeholder="010-1234-5678">
      </div>

      <div id="agent-fields" style="display:none">
        <div class="form-group">
          <label class="form-label">상호명</label>
          <input id="reg-biz-name" class="form-input" placeholder="예) 스마트쇼핑">
        </div>
        <div class="form-group">
          <label class="form-label">사업자 번호</label>
          <input id="reg-biz-num" class="form-input" placeholder="123-45-67890">
        </div>
        <div class="alert alert-info">에이전트 가입 후 관리자 승인이 필요합니다.</div>
      </div>

      <button class="btn btn-primary btn-block" onclick="doRegister()">가입하기</button>
      <div class="form-divider">이미 계정이 있으신가요?</div>
      <button class="btn btn-outline btn-block" onclick="navigate('/login')">로그인</button>
    </div>`;

  let selectedRole = 'user';
  window.switchRole = (role) => {
    selectedRole = role;
    document.getElementById('tab-user').classList.toggle('active', role === 'user');
    document.getElementById('tab-agent').classList.toggle('active', role === 'agent');
    document.getElementById('agent-fields').style.display = role === 'agent' ? '' : 'none';
  };

  window.doRegister = async () => {
    const errEl = document.getElementById('reg-error');
    errEl.style.display = 'none';
    const body = {
      firstName: document.getElementById('reg-first').value,
      lastName:  document.getElementById('reg-last').value,
      email:     document.getElementById('reg-email').value,
      password:  document.getElementById('reg-pw').value,
      phone:     document.getElementById('reg-phone').value,
      role:      selectedRole,
    };
    if (selectedRole === 'agent') {
      body.businessName   = document.getElementById('reg-biz-name').value;
      body.businessNumber = document.getElementById('reg-biz-num').value;
    }
    try {
      await post('/auth/register', body);
      toast('가입 완료! 로그인해주세요.');
      navigate('/login');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Agent Panel
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/agent', async () => {
  if (!isLoggedIn() || !isRole('agent')) { navigate('/'); return; }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container">
      <div class="row mb-2">
        <h1 class="page-title" style="margin:0;flex:1">내 상품 관리</h1>
        <button class="btn btn-primary" onclick="navigate('/agent/new')">+ 상품 등록</button>
      </div>
      <div id="my-products"><div class="loading">불러오는 중...</div></div>
    </div>`;

  try {
    const data = await get('/products/my');
    const products = data.items ?? [];
    const el = document.getElementById('my-products');
    if (!products.length) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">📦</div><p>등록된 상품이 없습니다.</p></div>';
      return;
    }
    el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>상품명</th><th>가격</th><th>상태</th><th>재고</th><th>액션</th></tr></thead>
        <tbody>
          ${products.map(p => `
            <tr>
              <td><strong>${p.name}</strong><br><span class="text-muted">${p.sku ?? ''}</span></td>
              <td>${won(p.price)}</td>
              <td>${statusChip(p.status)}</td>
              <td>${p.stock ?? '-'}</td>
              <td>
                <button class="btn btn-sm btn-outline" onclick="navigate('/products/${p._id}')">보기</button>
                <button class="btn btn-sm btn-danger" onclick="agentDelete('${p._id}')">삭제</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    window.agentDelete = async (id) => {
      if (!confirm('상품을 삭제하시겠습니까?')) return;
      try { await del(`/products/${id}`); toast('삭제되었습니다.'); navigate('/agent'); }
      catch (err) { toast(err.message, 'error'); }
    };
  } catch (err) {
    document.getElementById('my-products').innerHTML = `<div class="alert alert-warning">${err.message}</div>`;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Agent — New Product
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/agent', async ([sub]) => {
  // handled above for root '/agent', but sub='new' case:
  if (sub !== 'new') return;
  if (!isLoggedIn() || !isRole('agent')) { navigate('/'); return; }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="form-card" style="max-width:560px">
      <div class="mb-2"><a onclick="navigate('/agent')" style="cursor:pointer;color:#4f46e5">← 내 상품으로</a></div>
      <div class="form-title">상품 등록</div>
      <div id="prod-error" class="alert alert-warning mb-2" style="display:none"></div>
      <div class="form-group"><label class="form-label">상품명</label><input id="p-name" class="form-input" placeholder="상품명 입력"></div>
      <div class="form-group"><label class="form-label">카테고리 ID</label><input id="p-cat" class="form-input" placeholder="카테고리 UUID"></div>
      <div class="form-group"><label class="form-label">설명</label><textarea id="p-desc" class="form-input" rows="4" placeholder="상품 설명"></textarea></div>
      <div class="row">
        <div class="form-group" style="flex:1"><label class="form-label">판매가 (원)</label><input id="p-price" class="form-input" type="number" placeholder="50000"></div>
        <div class="form-group" style="flex:1"><label class="form-label">정가 (원)</label><input id="p-compare" class="form-input" type="number" placeholder="60000"></div>
      </div>
      <div class="form-group"><label class="form-label">SKU</label><input id="p-sku" class="form-input" placeholder="PROD-001"></div>
      <div class="form-group"><label class="form-label">무게 (g)</label><input id="p-weight" class="form-input" type="number" placeholder="500"></div>
      <div class="alert alert-info mb-2">등록 후 관리자 승인이 필요합니다.</div>
      <button class="btn btn-primary btn-block" onclick="submitProduct()">상품 등록</button>
    </div>`;

  window.submitProduct = async () => {
    const errEl = document.getElementById('prod-error');
    errEl.style.display = 'none';
    try {
      await post('/products', {
        name:         document.getElementById('p-name').value,
        categoryId:   document.getElementById('p-cat').value,
        description:  document.getElementById('p-desc').value,
        price:        parseInt(document.getElementById('p-price').value),
        comparePrice: parseInt(document.getElementById('p-compare').value) || undefined,
        sku:          document.getElementById('p-sku').value,
        weightG:      parseInt(document.getElementById('p-weight').value) || undefined,
        images:       [],
        tags:         [],
      });
      toast('상품이 등록되었습니다! 관리자 승인 대기 중입니다.');
      navigate('/agent');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Admin Panel
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/admin', async ([sub]) => {
  if (!isLoggedIn() || !isRole('admin', 'super-admin')) { navigate('/'); toast('권한이 없습니다.', 'error'); return; }
  const app = document.getElementById('app');
  const activeTab = sub ?? 'agents';

  app.innerHTML = `
    <div class="container">
      <h1 class="page-title">관리자 패널</h1>
      <div class="tab-bar">
        <div class="tab ${activeTab === 'agents' ? 'active' : ''}" onclick="navigate('/admin/agents')">에이전트 승인</div>
        <div class="tab ${activeTab === 'products' ? 'active' : ''}" onclick="navigate('/admin/products')">상품 승인</div>
      </div>
      <div id="admin-content"><div class="loading">불러오는 중...</div></div>
    </div>`;

  if (activeTab === 'agents') await renderPendingAgents();
  else if (activeTab === 'products') await renderPendingProducts();
});

async function renderPendingAgents() {
  const el = document.getElementById('admin-content');
  try {
    const data = await get('/agents/pending');
    const agents = data.items ?? [];
    if (!agents.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><p>승인 대기 에이전트가 없습니다.</p></div>'; return; }
    el.innerHTML = `<div class="panel-grid">${agents.map(a => `
      <div class="panel-card">
        <h3>${a.businessName}</h3>
        <p>사업자번호: ${a.businessNumber}</p>
        <p>수수료: ${a.commissionRate}%</p>
        <p>신청일: ${new Date(a.createdAt).toLocaleDateString('ko-KR')}</p>
        <div class="panel-card-actions">
          <button class="btn btn-sm btn-success" onclick="approveAgent('${a.id}')">승인</button>
          <button class="btn btn-sm btn-danger"  onclick="rejectAgent('${a.id}')">거절</button>
        </div>
      </div>`).join('')}</div>`;

    window.approveAgent = async (id) => {
      try { await patch(`/agents/${id}/approve`, {}); toast('에이전트가 승인되었습니다.'); await renderPendingAgents(); }
      catch (err) { toast(err.message, 'error'); }
    };
    window.rejectAgent = async (id) => {
      const reason = prompt('거절 사유를 입력하세요:');
      if (!reason) return;
      try { await patch(`/agents/${id}/reject`, { reason }); toast('에이전트가 거절되었습니다.'); await renderPendingAgents(); }
      catch (err) { toast(err.message, 'error'); }
    };
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">${err.message}</div>`;
  }
}

async function renderPendingProducts() {
  const el = document.getElementById('admin-content');
  try {
    const data = await get('/products/pending');
    const products = data.items ?? [];
    if (!products.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><p>승인 대기 상품이 없습니다.</p></div>'; return; }
    el.innerHTML = `<div class="panel-grid">${products.map(p => `
      <div class="panel-card">
        <h3>${p.name}</h3>
        <p>가격: ${won(p.price)}</p>
        <p>SKU: ${p.sku}</p>
        <p>등록일: ${new Date(p.createdAt).toLocaleDateString('ko-KR')}</p>
        <div class="panel-card-actions">
          <button class="btn btn-sm btn-success" onclick="approveProduct('${p.id}')">승인</button>
          <button class="btn btn-sm btn-danger"  onclick="rejectProduct('${p.id}')">거절</button>
          <button class="btn btn-sm btn-outline" onclick="navigate('/products/${p.id}')">상세</button>
        </div>
      </div>`).join('')}</div>`;

    window.approveProduct = async (id) => {
      try { await patch(`/products/${id}/approve`, {}); toast('상품이 승인되었습니다.'); await renderPendingProducts(); }
      catch (err) { toast(err.message, 'error'); }
    };
    window.rejectProduct = async (id) => {
      const reason = prompt('거절 사유를 입력하세요:');
      if (!reason) return;
      try { await patch(`/products/${id}/reject`, { reason }); toast('상품이 거절되었습니다.'); await renderPendingProducts(); }
      catch (err) { toast(err.message, 'error'); }
    };
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">${err.message}</div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: Profile
// ─────────────────────────────────────────────────────────────────────────────
registerRoute('/profile', async () => {
  if (!isLoggedIn()) { navigate('/login'); return; }
  const app = document.getElementById('app');
  try {
    const me = await get('/auth/me');
    app.innerHTML = `
      <div class="form-card">
        <div class="form-title">내 프로필</div>
        <table class="data-table mb-2">
          <tbody>
            <tr><td><strong>이름</strong></td><td>${me.firstName} ${me.lastName}</td></tr>
            <tr><td><strong>이메일</strong></td><td>${me.email}</td></tr>
            <tr><td><strong>역할</strong></td><td>${statusChip(me.role?.toUpperCase())}</td></tr>
            <tr><td><strong>전화</strong></td><td>${me.phone ?? '-'}</td></tr>
            <tr><td><strong>가입일</strong></td><td>${new Date(me.createdAt).toLocaleDateString('ko-KR')}</td></tr>
          </tbody>
        </table>
        <button class="btn btn-outline btn-block" onclick="logout()">로그아웃</button>
      </div>`;
  } catch (err) {
    app.innerHTML = `<div class="container"><div class="alert alert-warning">${err.message}</div></div>`;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix: /agent/new needs its own route
// ─────────────────────────────────────────────────────────────────────────────
const _agentRoute = routes['/agent'];
routes['/agent'] = async (parts) => {
  if (parts?.[0] === 'new') {
    // Render new product form
    if (!isLoggedIn() || !isRole('agent')) { navigate('/'); return; }
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="form-card" style="max-width:560px">
        <div class="mb-2"><a onclick="navigate('/agent')" style="cursor:pointer;color:#4f46e5">← 내 상품으로</a></div>
        <div class="form-title">상품 등록</div>
        <div id="prod-error" class="alert alert-warning mb-2" style="display:none"></div>
        <div class="form-group"><label class="form-label">상품명 *</label><input id="p-name" class="form-input" placeholder="상품명 입력"></div>
        <div class="form-group"><label class="form-label">설명</label><textarea id="p-desc" class="form-input" rows="4" placeholder="상품 설명"></textarea></div>
        <div class="row">
          <div class="form-group" style="flex:1"><label class="form-label">판매가 (원) *</label><input id="p-price" class="form-input" type="number" placeholder="50000"></div>
          <div class="form-group" style="flex:1"><label class="form-label">정가 (원)</label><input id="p-compare" class="form-input" type="number" placeholder="60000"></div>
        </div>
        <div class="form-group"><label class="form-label">SKU *</label><input id="p-sku" class="form-input" placeholder="PROD-001"></div>
        <div class="form-group"><label class="form-label">무게 (g)</label><input id="p-weight" class="form-input" type="number" placeholder="500"></div>
        <div class="alert alert-info mb-2">등록 후 관리자 승인이 필요합니다.</div>
        <button class="btn btn-primary btn-block" onclick="submitProductForm()">상품 등록</button>
      </div>`;

    window.submitProductForm = async () => {
      const errEl = document.getElementById('prod-error');
      errEl.style.display = 'none';
      try {
        await post('/products', {
          name:         document.getElementById('p-name').value,
          description:  document.getElementById('p-desc').value,
          price:        parseInt(document.getElementById('p-price').value),
          comparePrice: parseInt(document.getElementById('p-compare').value) || undefined,
          sku:          document.getElementById('p-sku').value,
          weightG:      parseInt(document.getElementById('p-weight').value) || undefined,
          images:       [],
          tags:         [],
        });
        toast('상품이 등록되었습니다! 관리자 승인 대기 중입니다.');
        navigate('/agent');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
      }
    };
    return;
  }
  return _agentRoute(parts);
};
