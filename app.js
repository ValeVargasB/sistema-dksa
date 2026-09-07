import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp, runTransaction, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBg5WqHTsoZoq_5z5-1tkn84AJur0TNvVw",
  authDomain: "tiendaba-558bb.firebaseapp.com",
  projectId: "tiendaba-558bb",
  storageBucket: "tiendaba-558bb.firebasestorage.app",
  messagingSenderId: "696147969361",
  appId: "1:696147969361:web:ac626c304e799b4354bf70",
  measurementId: "G-R9ZSXTZB2M"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let clients = [];
let sales = [];
let products = [];
let saleItems = [];
let payments = [];
let currentItems = [];
let paymentSaleId = null;
let stockProductId = null;
let nextProductNumber = 1;
let editingProductId = null;
let editingClientId = null;
let dashboardDate = new Date();

const money = value => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' }).format(Number(value || 0));
const dateText = value => value ? new Date(value).toLocaleDateString('es-CR') : '-';
const inputDateText = value => {
  const date = value ? new Date(value) : new Date();
  return date.toISOString().slice(0, 10);
};
const dateInputValue = date => {
  const value = date ? new Date(date) : new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const parseDateInput = value => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const nowDate = () => new Date();
const toDate = value => value?.toDate ? value.toDate() : value ? new Date(value) : null;
const saleNumber = number => `V-${String(number).padStart(6, '0')}`;
const productCode = number => `PRO-${String(number).padStart(2, '0')}`;
const itemSubtotal = item => Number(item.cantidad) * Number(item.precioUnitario);
const totalItems = items => items.reduce((sum, item) => sum + itemSubtotal(item), 0);
const productIcon = product => {
  const name = `${product.nombre || ''} ${product.codigo || ''}`.toLowerCase();
  if (name.includes('dino')) return '🦖';
  if (name.includes('peluche')) return '🧸';
  if (name.includes('mochila')) return '🎒';
  if (name.includes('zapato') || name.includes('tenis')) return '👟';
  if (name.includes('camisa') || name.includes('blusa')) return '👕';
  return '📦';
};
const saleStatus = (balance, dueDate) => {
  if (balance <= 0) return 'Pagado';
  if (dueDate && nowDate() > new Date(dueDate)) return 'Vencido';
  return 'Pendiente';
};

const titles = {
  dashboard: ['Dashboard', 'Resumen general de la tienda'],
  clientes: ['Clientes', 'Registro y búsqueda de clientes'],
  inventario: ['Inventario', 'Productos y existencias disponibles'],
  ventas: ['Ventas', 'Consulta de ventas y apartados'],
  nuevaVenta: ['Nueva venta', 'Venta de contado o apartado']
};

const el = id => document.getElementById(id);

function showView(view) {
  document.querySelectorAll('.view').forEach(node => node.classList.toggle('active', node.id === view));
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  const pageTitle = el('pageTitle');
  const pageSubtitle = el('pageSubtitle');
  if (pageTitle) pageTitle.textContent = titles[view][0];
  if (pageSubtitle) pageSubtitle.textContent = titles[view][1];
  if (view === 'nuevaVenta') renderSaleForm();
}

document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
el('refreshBtn').addEventListener('click', loadAll);

async function ensureSettings() {
  const ref = doc(db, 'configuracion', 'general');
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ultimaVenta: 0, ultimaProducto: 0, nombreTienda: 'Mi Tienda', mensajeGracias: 'Gracias por su compra' });
    nextProductNumber = 1;
  } else if (snap.data()?.ultimaProducto === undefined) {
    await setDoc(ref, { ultimaProducto: 0 }, { merge: true });
    nextProductNumber = 1;
  } else {
    nextProductNumber = Number(snap.data()?.ultimaProducto || 0) + 1;
  }
}

async function loadAll() {
  await ensureSettings();
  const [clientSnap, saleSnap, productSnap, itemSnap, paymentSnap] = await Promise.all([
    getDocs(query(collection(db, 'clientes'), orderBy('fechaRegistro', 'desc'))),
    getDocs(query(collection(db, 'ventas'), orderBy('fechaVenta', 'desc'))),
    getDocs(query(collection(db, 'productos'), orderBy('nombre', 'asc'))),
    getDocs(collection(db, 'articulosVenta')),
    getDocs(collection(db, 'abonos'))
  ]);
  clients = clientSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  sales = saleSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  products = productSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  saleItems = itemSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  payments = paymentSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderClients();
  renderProducts();
  renderNextProductCode();
  renderSaleForm();
  renderSales();
  renderDashboard();
}

function renderNextProductCode() {
  if (!editingProductId) el('productCode').value = productCode(nextProductNumber);
}

function resetProductForm() {
  editingProductId = null;
  el('productForm').reset();
  el('productStock').value = 1;
  el('productFormTitle').textContent = 'Registrar producto';
  el('productSubmitBtn').textContent = 'Guardar producto';
  el('cancelProductEdit').classList.add('hidden');
  el('productStockField').classList.remove('hidden');
  el('productStockField').firstChild.textContent = 'Ingreso inicial';
  el('productStock').disabled = false;
  el('productStock').required = true;
  renderNextProductCode();
}

function renderDashboard() {
  const today = new Date();
  const selectedDate = dashboardDate || today;
  const selectedDateStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
  const dayKey = value => {
    const date = toDate(value);
    if (!date) return '';
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };
  const sameDay = value => {
    const d = toDate(value);
    return d && d.toDateString() === selectedDate.toDateString();
  };
  const selectedSales = sales.filter(s => sameDay(s.fechaVenta));
  const selectedSaleIds = new Set(selectedSales.map(s => s.id));
  const selectedSoldUnits = saleItems
    .filter(item => selectedSaleIds.has(item.ventaId))
    .reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
  const activeProducts = products.filter(product => product.activo !== false);
  const currentStock = activeProducts.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const inventoryValue = activeProducts.reduce((sum, product) => {
    return sum + (Number(product.totalIngresado ?? product.stock ?? 0) * Number(product.precioVenta || 0));
  }, 0);
  const selectedSoldTotal = selectedSales.reduce((a, s) => a + Number(s.total || 0), 0);
  const paymentTotals = selectedSales.reduce((acc, sale) => {
    if (sale.tipoVenta !== 'Contado') return acc;
    const method = sale.metodoPago || 'Contado';
    acc[method] = (acc[method] || 0) + Number(sale.total || 0);
    return acc;
  }, {});
  payments.filter(payment => sameDay(payment.fechaAbono)).forEach(payment => {
    const method = payment.metodoPago || 'Sin método';
    paymentTotals[method] = (paymentTotals[method] || 0) + Number(payment.monto || 0);
  });
  const paymentGrandTotal = Object.values(paymentTotals).reduce((sum, value) => sum + value, 0);
  const paymentRows = Object.entries(paymentTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(selectedDateStart);
    date.setDate(selectedDateStart.getDate() - (6 - index));
    const total = sales
      .filter(sale => dayKey(sale.fechaVenta) === dayKey(date))
      .reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    return { date, total };
  });
  const maxChartValue = Math.max(...lastSevenDays.map(day => day.total), 1);
  const chartPoints = lastSevenDays.map((day, index) => {
    const x = 8 + (index * (84 / Math.max(lastSevenDays.length - 1, 1)));
    const y = 88 - ((day.total / maxChartValue) * 68);
    return `${x},${y}`;
  }).join(' ');
  const chartArea = `8,88 ${chartPoints} 92,88`;

  const cards = [
    { label: 'Total vendido del día', value: money(selectedSoldTotal), tone: 'blue', icon: '$', note: 'Según la fecha elegida', action: 'day' },
    { label: 'Ventas del día', value: selectedSales.length, tone: 'green', icon: 'C', note: 'Cantidad de ventas', action: 'day' },
    { label: 'Apartados pendientes', value: sales.filter(s => s.tipoVenta === 'Apartado' && s.estado === 'Pendiente').length, tone: 'orange', icon: 'A', note: 'Por cobrar', action: 'pending' },
    { label: 'Apartados vencidos', value: sales.filter(s => s.tipoVenta === 'Apartado' && s.estado === 'Vencido').length, tone: 'red', icon: '!', note: 'Revisar seguimiento', action: 'expired' },
    { label: 'Ventas contado', value: sales.filter(s => s.tipoVenta === 'Contado').length, tone: 'purple', icon: 'P', note: 'Histórico total', action: 'cash' },
    { label: 'Ventas apartado', value: sales.filter(s => s.tipoVenta === 'Apartado').length, tone: 'cyan', icon: 'L', note: 'Histórico total', action: 'layaway' },
    { label: 'Existencias en inventario', value: currentStock, tone: 'blue', icon: 'B', note: 'unidades disponibles' },
    { label: 'Valor del inventario', value: money(inventoryValue), tone: 'green', icon: '$', note: 'valor ingresado total' },
    { label: 'Productos registrados', value: activeProducts.length, tone: 'orange', icon: '#', note: 'productos en total' },
    { label: 'Productos vendidos del día', value: selectedSoldUnits, tone: 'purple', icon: '↗', note: 'unidades vendidas', action: 'day' }
  ];

  el('metricsGrid').innerHTML = `
    <div class="dashboard-shell">
      <div class="dashboard-hero">
        <div>
          <h3>Buenos días, <span>Valeria</span> <b aria-hidden="true">☀</b></h3>
          <p>Resumen general de tu tienda</p>
        </div>
        <label class="dashboard-date">
          <span>Buscar día</span>
          <input type="date" value="${dateInputValue(selectedDate)}" onchange="setDashboardDate(this.value)" />
        </label>
      </div>

      <div class="dashboard-cards">
        ${cards.map(card => `
          <${card.action ? 'button' : 'div'} ${card.action ? `type="button" onclick="openDashboardSales('${card.action}')" aria-label="Ver ${card.label}"` : ''} class="dash-card ${card.action ? 'dashboard-link' : ''} ${card.wide ? 'dash-card-wide' : ''} tone-${card.tone}">
            <div class="dash-icon">${card.icon}</div>
            <div class="dash-card-body">
              <span>${card.label}</span>
              <strong>${card.value}</strong>
              <small>${card.note}</small>
            </div>
          </${card.action ? 'button' : 'div'}>
        `).join('')}
      </div>

      <div class="dashboard-panels">
        <section class="dashboard-panel sales-chart-panel">
          <div class="panel-title-row">
            <h3>Ventas de los últimos 7 días</h3>
            <span>Últimos 7 días</span>
          </div>
          <svg class="sales-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Gráfico de ventas">
            <defs>
              <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="#246bfe" stop-opacity=".24" />
                <stop offset="100%" stop-color="#246bfe" stop-opacity="0" />
              </linearGradient>
            </defs>
            <polygon points="${chartArea}" fill="url(#salesFill)"></polygon>
            <polyline points="${chartPoints}" fill="none" stroke="#246bfe" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></polyline>
            ${lastSevenDays.map((day, index) => {
              const x = 8 + (index * (84 / Math.max(lastSevenDays.length - 1, 1)));
              const y = 88 - ((day.total / maxChartValue) * 68);
              return `<circle cx="${x}" cy="${y}" r="1.7" fill="#246bfe"></circle>`;
            }).join('')}
          </svg>
          <div class="chart-labels">
            ${lastSevenDays.map(day => `<span>${day.date.toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })}</span>`).join('')}
          </div>
        </section>

        <section class="dashboard-panel payment-panel">
          <h3>Formas de pago</h3>
          <div class="payment-dashboard-content">
            <div class="donut" style="--p1:${paymentGrandTotal ? ((paymentRows[0]?.[1] || 0) / paymentGrandTotal) * 100 : 100}; --p2:${paymentGrandTotal ? ((paymentRows[1]?.[1] || 0) / paymentGrandTotal) * 100 : 0};">
              <div>
                <span>Total</span>
                <strong>${money(paymentGrandTotal)}</strong>
              </div>
            </div>
            <div class="payment-list">
              ${paymentRows.length ? paymentRows.map(([method, total], index) => `
                <div>
                  <span class="pay-dot pay-${index}"></span>
                  <strong>${method}</strong>
                  <small>${paymentGrandTotal ? Math.round((total / paymentGrandTotal) * 100) : 0}%</small>
                  <b>${money(total)}</b>
                </div>
              `).join('') : '<p class="muted">Sin abonos registrados.</p>'}
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

}

window.setDashboardDate = value => {
  if (!value) return;
  dashboardDate = parseDateInput(value);
  renderDashboard();
};

el('clientForm').addEventListener('submit', async event => {
  event.preventDefault();

  const form = event.target;
  const button = el('clientSubmitBtn');
  const name = el('clientName').value.trim();

  if (!name) {
    alert('Ingrese el nombre del cliente.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Guardando...';

  try {
    const clientData = {
      nombre: name,
      telefono: el('clientPhone').value.trim(),
      observaciones: el('clientNotes').value.trim(),
      actualizadoEn: serverTimestamp()
    };

    if (editingClientId) {
      await updateDoc(doc(db, 'clientes', editingClientId), clientData);
      alert('Cliente actualizado correctamente.');
    } else {
      await addDoc(collection(db, 'clientes'), {
        ...clientData,
        fechaRegistro: serverTimestamp()
      });
      alert('Cliente guardado correctamente.');
    }

    resetClientForm();
    await loadAll();
  } catch (error) {
    console.error('Error al guardar cliente:', error);
    alert(`No se pudo guardar el cliente: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = editingClientId ? 'Guardar cambios' : 'Guardar cliente';
  }
});

function resetClientForm() {
  editingClientId = null;
  el('clientForm').reset();
  el('clientFormTitle').textContent = 'Registrar cliente';
  el('clientSubmitBtn').textContent = 'Guardar cliente';
  el('cancelClientEdit').classList.add('hidden');
}

el('cancelClientEdit').addEventListener('click', resetClientForm);

window.editClient = id => {
  const client = clients.find(item => item.id === id);
  if (!client) return alert('No se encontró el cliente. Actualice la lista e inténtelo de nuevo.');

  editingClientId = id;
  el('clientName').value = client.nombre || '';
  el('clientPhone').value = client.telefono || '';
  el('clientNotes').value = client.observaciones || '';
  el('clientFormTitle').textContent = 'Editar cliente';
  el('clientSubmitBtn').textContent = 'Guardar cambios';
  el('cancelClientEdit').classList.remove('hidden');
  el('clientName').focus();
};

window.deleteClient = async id => {
  const client = clients.find(item => item.id === id);
  if (!client) return alert('No se encontró el cliente. Actualice la lista e inténtelo de nuevo.');
  if (!confirm(`¿Está seguro de que desea eliminar a ${client.nombre || 'este cliente'}?`)) return;

  try {
    await deleteDoc(doc(db, 'clientes', id));
    if (editingClientId === id) resetClientForm();
    await loadAll();
    alert('Cliente eliminado correctamente.');
  } catch (error) {
    console.error('Error al eliminar cliente:', error);
    alert(`No se pudo eliminar el cliente: ${error.message}`);
  }
};

el('clientSearch').addEventListener('input', renderClients);
function renderClients() {
  const text = el('clientSearch').value?.toLowerCase() || '';
  const filtered = clients.filter(c => `${c.nombre} ${c.telefono}`.toLowerCase().includes(text));
  el('clientsList').innerHTML = filtered.length ? filtered.map(c => `
    <div class="row">
      <div class="row-top"><strong>${c.nombre || 'Sin nombre'}</strong><span class="muted">${c.telefono || 'Sin teléfono'}</span></div>
      <span class="muted">${c.observaciones || ''}</span>
      <div class="actions">
        <button class="secondary" type="button" onclick="editClient('${c.id}')">Editar</button>
        <button class="danger" type="button" onclick="deleteClient('${c.id}')">Eliminar</button>
      </div>
    </div>
  `).join('') : '<p class="muted">No hay clientes.</p>';
}

el('productForm').addEventListener('submit', async event => {
  event.preventDefault();

  const form = event.target;
  const button = el('productSubmitBtn');
  const name = el('productName').value.trim();
  const price = Number(el('productPrice').value || 0);
  const stock = Number(el('productStock').value || 0);

  if (!name) return alert('Ingrese el nombre del producto.');
  if (price <= 0) return alert('El precio de venta debe ser mayor a cero.');
  if (stock < 0) return alert('La existencia no puede ser negativa.');

  button.disabled = true;
  button.textContent = 'Guardando...';

  try {
    if (editingProductId) {
      await updateDoc(doc(db, 'productos', editingProductId), {
        nombre: name,
        precioVenta: price,
        stock,
        totalIngresado: stock,
        observaciones: el('productNotes').value.trim(),
        activo: true,
        updatedAt: serverTimestamp()
      });

      resetProductForm();
      await loadAll();
      alert('Producto actualizado correctamente.');
      return;
    }

    await runTransaction(db, async tx => {
      const settingsRef = doc(db, 'configuracion', 'general');
      const settings = await tx.get(settingsRef);
      const nextProduct = Number(settings.data()?.ultimaProducto || 0) + 1;
      const newProductRef = doc(collection(db, 'productos'));

      tx.set(settingsRef, { ultimaProducto: nextProduct }, { merge: true });
      tx.set(newProductRef, {
        nombre: name,
        codigo: productCode(nextProduct),
        precioVenta: price,
        stock,
        totalIngresado: stock,
        observaciones: el('productNotes').value.trim(),
        activo: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });

    resetProductForm();
    await loadAll();
    alert('Producto guardado correctamente.');
  } catch (error) {
    console.error('Error al guardar producto:', error);
    alert(`No se pudo guardar el producto: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = editingProductId ? 'Actualizar producto' : 'Guardar producto';
  }
});

el('cancelProductEdit').addEventListener('click', resetProductForm);

el('productSearch').addEventListener('input', renderProducts);
function renderProducts() {
  const text = el('productSearch').value?.toLowerCase() || '';
  const activeProducts = products.filter(p => p.activo !== false);
  const filtered = activeProducts.filter(p => `${p.nombre} ${p.codigo}`.toLowerCase().includes(text));
  const saleIds = new Set(sales.map(sale => sale.id));
  const totalEntered = activeProducts.reduce((sum, product) => sum + Number(product.totalIngresado ?? product.stock ?? 0), 0);
  const currentStock = activeProducts.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const soldFromSales = saleItems
    .filter(item => saleIds.has(item.ventaId))
    .reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
  const inventoryValue = activeProducts.reduce((sum, product) => {
    return sum + (Number(product.totalIngresado ?? product.stock ?? 0) * Number(product.precioVenta || 0));
  }, 0);

  el('inventorySummary').innerHTML = `
    <div class="inventory-summary-box summary-blue">
      <div class="summary-icon">↓</div>
      <span>Total ingresado al inventario</span>
      <strong>${totalEntered}</strong>
    </div>
    <div class="inventory-summary-box summary-green">
      <div class="summary-icon">□</div>
      <span>Existencia actual</span>
      <strong>${currentStock}</strong>
    </div>
    <div class="inventory-summary-box summary-purple">
      <div class="summary-icon">₡</div>
      <span>Valor inventario</span>
      <strong>${money(inventoryValue)}</strong>
    </div>
    <div class="inventory-summary-box summary-orange">
      <div class="summary-icon">−</div>
      <span>Descontado por ventas</span>
      <strong>${soldFromSales}</strong>
    </div>
  `;

  el('productsList').innerHTML = filtered.length ? filtered.map(p => {
    const stock = Number(p.stock || 0);
    const entered = Number(p.totalIngresado ?? p.stock ?? 0);
    const soldInSales = saleItems
      .filter(item => item.productoId === p.id && saleIds.has(item.ventaId))
      .reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
    const stockClass = stock <= 0 ? 'Vencido' : 'Pagado';
    const stockText = stock <= 0 ? 'Sin stock' : 'Disponible';
    return `
      <div class="inventory-product-card">
        <div class="inventory-product-head">
          <div>
            <strong>${p.nombre || 'Sin nombre'}</strong>
            <div class="muted">${p.codigo || 'Sin código'}</div>
          </div>
          <span class="badge ${stockClass}">${stockText}</span>
        </div>
        <div class="inventory-product-data">
          <div><span>Existencia</span><strong class="stock-value">${stock}</strong></div>
          <div><span>Ingresado</span><strong>${entered}</strong></div>
          <div><span>Descontado por ventas</span><strong>${soldInSales}</strong></div>
          <div><span>Precio venta</span><strong>${money(p.precioVenta || 0)}</strong></div>
        </div>
        <div class="inventory-actions">
          <button type="button" class="secondary inventory-action-blue" onclick="openStockEntry('${p.id}')">▣ Ingresar stock</button>
          <button type="button" class="secondary" onclick="editProduct('${p.id}')">✎ Editar</button>
          <button type="button" class="secondary inventory-action-red" onclick="deleteProduct('${p.id}')">▢ Eliminar</button>
        </div>
      </div>
    `;
  }).join('') : '<p class="muted">No hay productos registrados.</p>';
}

window.editProduct = productId => {
  const product = products.find(p => p.id === productId);
  if (!product) return alert('No se encontró el producto.');

  editingProductId = productId;
  el('productFormTitle').textContent = 'Editar producto';
  el('productSubmitBtn').textContent = 'Actualizar producto';
  el('cancelProductEdit').classList.remove('hidden');
  el('productName').value = product.nombre || '';
  el('productCode').value = product.codigo || '';
  el('productPrice').value = Number(product.precioVenta || 0);
  el('productNotes').value = product.observaciones || '';
  el('productStock').value = Number(product.stock || 0);
  el('productStock').disabled = false;
  el('productStock').required = true;
  el('productStockField').classList.remove('hidden');
  el('productStockField').firstChild.textContent = 'Existencia';
  el('productName').focus();
};

window.deleteProduct = async productId => {
  const product = products.find(p => p.id === productId);
  if (!product) return alert('No se encontró el producto.');

  const confirmed = confirm(`¿Eliminar el producto ${product.codigo || ''} ${product.nombre || ''}?`);
  if (!confirmed) return;

  try {
    await updateDoc(doc(db, 'productos', productId), {
      activo: false,
      updatedAt: serverTimestamp()
    });
    if (editingProductId === productId) resetProductForm();
    await loadAll();
    alert('Producto eliminado correctamente.');
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    alert(`No se pudo eliminar el producto: ${error.message}`);
  }
};

window.openStockEntry = productId => {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  stockProductId = productId;
  el('stockProductInfo').textContent = `${product.codigo || 'Sin código'} · ${product.nombre || 'Sin nombre'} · Existencia actual: ${Number(product.stock || 0)}`;
  el('stockEntryQty').value = '';
  el('stockEntryNotes').value = '';
  el('stockDialog').showModal();
  setTimeout(() => el('stockEntryQty').focus(), 50);
};

function closeStockEntry() {
  stockProductId = null;
  el('stockDialog').close();
}

el('cancelStockEntry').addEventListener('click', closeStockEntry);

el('stockForm').addEventListener('submit', async event => {
  event.preventDefault();

  const product = products.find(p => p.id === stockProductId);
  if (!product) return;

  const quantity = Number(el('stockEntryQty').value || 0);
  if (!quantity || quantity <= 0) return alert('Ingrese una cantidad mayor a cero.');

  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Sumando...';

  try {
    await runTransaction(db, async tx => {
      const productRef = doc(db, 'productos', stockProductId);
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists()) throw new Error('El producto ya no existe.');

      const data = productSnap.data();
      const currentStock = Number(data.stock || 0);
      const currentTotalEntered = Number(data.totalIngresado ?? data.stock ?? 0);

      tx.update(productRef, {
        stock: currentStock + quantity,
        totalIngresado: currentTotalEntered + quantity,
        updatedAt: serverTimestamp()
      });

      tx.set(doc(collection(db, 'movimientosInventario')), {
        productoId: stockProductId,
        productoNombre: data.nombre || product.nombre || '',
        tipo: 'Entrada',
        cantidad: quantity,
        observaciones: el('stockEntryNotes').value.trim(),
        fecha: serverTimestamp()
      });
    });

    closeStockEntry();
    await loadAll();
  } catch (error) {
    console.error('Error al ingresar inventario:', error);
    alert(`No se pudo ingresar inventario: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Sumar al inventario';
  }
});

el('saleType').addEventListener('change', renderSaleForm);
el('discount').addEventListener('input', renderSummary);
el('initialPayment').addEventListener('input', renderSummary);
el('addItemBtn').addEventListener('click', () => {
  el('itemProductSearch').value = '';
  el('itemProductInfo').textContent = '';
  el('itemPrice').value = '';
  renderProductOptions();
  el('itemDialog').showModal();
  setTimeout(() => el('itemProductSearch').focus(), 50);
});
el('cancelItem').addEventListener('click', () => el('itemDialog').close());
el('itemProductSearch').addEventListener('input', renderProductOptions);
el('itemForm').addEventListener('submit', event => {
  event.preventDefault();
  const product = products.find(p => p.id === el('itemProduct').value);
  if (!product) return alert('Seleccione un producto.');
  const quantity = Number(el('itemQty').value || 0);
  if (quantity <= 0) return alert('Ingrese una cantidad válida.');
  if (quantity > Number(product.stock || 0)) return alert('No hay suficiente existencia para este producto.');
  currentItems.push({
    productoId: product.id,
    nombreArticulo: product.nombre,
    codigo: product.codigo || '',
    cantidad: quantity,
    precioUnitario: Number(el('itemPrice').value)
  });
  event.target.reset();
  el('itemQty').value = 1;
  el('itemProductSearch').value = '';
  el('itemProduct').value = '';
  el('itemProductInfo').textContent = '';
  el('productResults').innerHTML = '';
  renderProductOptions();
  el('itemDialog').close();
  renderItems();
  renderSummary();
});

function renderSaleForm() {
  el('saleClient').innerHTML = '<option value="">Seleccione cliente</option>' + clients.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  if (!el('saleDate').value) el('saleDate').value = dateInputValue(new Date());
  renderProductOptions();
  const isLayaway = el('saleType').value === 'Apartado';
  document.querySelectorAll('.apartado-only').forEach(node => node.style.display = isLayaway ? 'grid' : 'none');
  renderItems();
  renderSummary();
}

function renderProductOptions() {
  const search = (el('itemProductSearch').value || '').trim().toLowerCase();
  const availableProducts = products
    .filter(p => Number(p.stock || 0) > 0 && p.activo !== false)
    .filter(p => `${p.nombre || ''} ${p.codigo || ''}`.toLowerCase().includes(search));

  if (!search) {
    el('productResults').innerHTML = '';
    return;
  }

  el('productResults').innerHTML = availableProducts.length ? availableProducts.map(p => `
    <button type="button" class="product-result" onclick="selectProduct('${p.id}')">
      <span class="product-result-icon">${productIcon(p)}</span>
      <span class="product-result-main">
        <strong>${p.nombre || 'Sin nombre'}</strong>
        <small>${p.codigo || 'Sin código'} · ${money(p.precioVenta || 0)}</small>
      </span>
      <span class="product-result-stock">Stock ${Number(p.stock || 0)}</span>
    </button>
  `).join('') : '<div class="product-no-results">No hay productos disponibles con esa búsqueda.</div>';

  if (el('itemProduct').value && !availableProducts.some(p => p.id === el('itemProduct').value)) {
    el('itemProduct').value = '';
    el('itemProductInfo').textContent = '';
    el('itemPrice').value = '';
  }
}

window.selectProduct = productId => {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  el('itemProduct').value = product.id;
  el('itemProductSearch').value = product.nombre || '';
  el('itemPrice').value = Number(product.precioVenta || 0);
  el('itemProductInfo').textContent = `Seleccionado: ${product.codigo || 'Sin código'} · Disponible: ${Number(product.stock || 0)} · Precio: ${money(product.precioVenta || 0)}`;
  el('productResults').innerHTML = '';
  el('itemQty').focus();
};

function renderItems() {
  el('itemsList').innerHTML = currentItems.length ? currentItems.map((item, index) => `
    <div class="row">
      <div class="row-top">
        <div><strong>${item.nombreArticulo}</strong><div class="muted">${item.cantidad} x ${money(item.precioUnitario)}</div></div>
        <div><strong>${money(itemSubtotal(item))}</strong> <button type="button" class="secondary" onclick="removeItem(${index})">Quitar</button></div>
      </div>
    </div>
  `).join('') : '<p class="muted">Agregue al menos un artículo.</p>';
}
window.removeItem = index => { currentItems.splice(index, 1); renderItems(); renderSummary(); };

function renderSummary() {
  const subtotal = totalItems(currentItems);
  const discount = Number(el('discount').value || 0);
  const total = Math.max(subtotal - discount, 0);
  const paid = el('saleType').value === 'Contado' ? total : Number(el('initialPayment').value || 0);
  const balance = Math.max(total - paid, 0);
  el('saleSummary').innerHTML = `
    <div><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
    <div><span>Descuento</span><strong>${money(discount)}</strong></div>
    <div><span>Total</span><strong>${money(total)}</strong></div>
    <div><span>Abonado</span><strong>${money(paid)}</strong></div>
    <div><span>Saldo</span><strong>${money(balance)}</strong></div>
  `;
}

el('saleForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentItems.length) return alert('Agregue al menos un artículo.');
  const client = clients.find(c => c.id === el('saleClient').value);
  if (!client) return alert('Seleccione un cliente.');
  const button = event.target.querySelector('button[type="submit"]');
  const type = el('saleType').value;
  const subtotal = totalItems(currentItems);
  const descuento = Number(el('discount').value || 0);
  const total = Math.max(subtotal - descuento, 0);
  const initial = type === 'Contado' ? total : Number(el('initialPayment').value || 0);
  if (initial > total) return alert('El abono no puede ser mayor al total.');
  if (type === 'Apartado' && !el('dueDate').value) return alert('Seleccione fecha límite.');
  const balance = Math.max(total - initial, 0);
  const saleDate = el('saleDate').value || dateInputValue(new Date());
  const due = el('dueDate').value || null;

  button.disabled = true;
  button.textContent = 'Guardando...';

  try {
    const saleRef = await runTransaction(db, async tx => {
      const settingsRef = doc(db, 'configuracion', 'general');
      const settings = await tx.get(settingsRef);
      const productSnapshots = [];

      for (const item of currentItems) {
        const productRef = doc(db, 'productos', item.productoId);
        const productSnap = await tx.get(productRef);
        if (!productSnap.exists()) throw new Error(`El producto ${item.nombreArticulo} ya no existe.`);
        const currentStock = Number(productSnap.data().stock || 0);
        if (currentStock < Number(item.cantidad || 0)) {
          throw new Error(`No hay suficiente existencia de ${item.nombreArticulo}. Disponible: ${currentStock}.`);
        }
        productSnapshots.push({ ref: productRef, stock: currentStock, item });
      }

      const next = Number(settings.data()?.ultimaVenta || 0) + 1;
      tx.set(settingsRef, { ultimaVenta: next }, { merge: true });
      const newSaleRef = doc(collection(db, 'ventas'));
      tx.set(newSaleRef, {
        numeroVenta: saleNumber(next), fechaVenta: Timestamp.fromDate(parseDateInput(saleDate)), tipoVenta: type,
        clienteId: client.id, clienteNombre: client.nombre, clienteTelefono: client.telefono || '',
        metodoPago: el('paymentMethod').value,
        subtotal, descuento, total, totalAbonado: initial, saldoPendiente: balance,
        estado: type === 'Contado' ? 'Pagado' : saleStatus(balance, due),
        fechaLimite: due ? Timestamp.fromDate(new Date(due + 'T23:59:59')) : null,
        observaciones: el('saleNotes').value.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      currentItems.forEach(item => tx.set(doc(collection(db, 'articulosVenta')), {
        ventaId: newSaleRef.id, ...item, subtotal: itemSubtotal(item), createdAt: serverTimestamp()
      }));
      productSnapshots.forEach(({ ref, stock, item }) => tx.update(ref, {
        stock: stock - Number(item.cantidad || 0),
        updatedAt: serverTimestamp()
      }));
      if (type === 'Apartado' && initial > 0) tx.set(doc(collection(db, 'abonos')), {
        ventaId: newSaleRef.id, fechaAbono: Timestamp.fromDate(parseDateInput(saleDate)), monto: initial,
        metodoPago: el('paymentMethod').value, numeroComprobante: '', observaciones: 'Abono inicial', createdAt: serverTimestamp()
      });
      return newSaleRef;
    });

    event.target.reset();
    el('discount').value = 0;
    el('initialPayment').value = 0;
    el('saleDate').value = dateInputValue(new Date());
    currentItems = [];
    await loadAll();
    showView('ventas');
    openSaleDetail(saleRef.id);
  } catch (error) {
    console.error('Error al guardar venta:', error);
    alert(`No se pudo guardar la venta: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Guardar venta';
  }
});

el('saleSearch').addEventListener('input', renderSales);
el('statusFilter').addEventListener('change', renderSales);
el('typeFilter').addEventListener('change', renderSales);
el('saleDateFilter').addEventListener('change', renderSales);
el('clearSalesFilters').addEventListener('click', () => {
  el('saleSearch').value = '';
  el('statusFilter').value = '';
  el('typeFilter').value = '';
  el('saleDateFilter').value = '';
  renderSales();
});

window.openDashboardSales = action => {
  const options = {
    day: { date: dateInputValue(dashboardDate || new Date()) },
    pending: { status: 'Pendiente', type: 'Apartado' },
    expired: { status: 'Vencido', type: 'Apartado' },
    cash: { type: 'Contado' },
    layaway: { type: 'Apartado' }
  };
  const filter = options[action];
  if (!filter) return;

  el('saleSearch').value = '';
  el('statusFilter').value = filter.status || '';
  el('typeFilter').value = filter.type || '';
  el('saleDateFilter').value = filter.date || '';
  showView('ventas');
  renderSales();
};

function renderSales() {
  const text = (el('saleSearch').value || '').toLowerCase();
  const status = el('statusFilter').value;
  const type = el('typeFilter').value;
  const date = el('saleDateFilter').value;
  const filtered = sales.filter(s => {
    const matchesText = `${s.numeroVenta} ${s.clienteNombre} ${s.clienteTelefono}`.toLowerCase().includes(text);
    const matchesDate = !date || (toDate(s.fechaVenta) && dateInputValue(toDate(s.fechaVenta)) === date);
    return matchesText && matchesDate && (!status || s.estado === status) && (!type || s.tipoVenta === type);
  });
  el('salesList').innerHTML = filtered.length ? filtered.map(s => `
    <div class="row">
      <div class="row-top">
        <div><strong>${s.numeroVenta} - ${s.clienteNombre}</strong><div class="muted">${dateText(toDate(s.fechaVenta))} · ${s.tipoVenta}</div></div>
        <span class="badge ${s.estado}">${s.estado}</span>
      </div>
      <div class="sale-money-lines">
        <div><span>Total</span><strong>${money(s.total)}</strong></div>
        <div><span>Abonado</span><strong>${money(s.totalAbonado)}</strong></div>
        <div><span>Saldo</span><strong>${money(s.saldoPendiente)}</strong></div>
      </div>
      <div class="actions">
        <button type="button" class="secondary" onclick="openSaleDetail('${s.id}')">Ver detalle</button>
        ${s.tipoVenta === 'Apartado' && Number(s.saldoPendiente || 0) > 0 ? `<button type="button" onclick="addPaymentPrompt('${s.id}')">Agregar abono</button>` : ''}
        <button type="button" class="danger" onclick="deleteSale('${s.id}')">Eliminar venta</button>
      </div>
    </div>
  `).join('') : '<p class="muted">No hay ventas.</p>';
}

window.openSaleDetail = async saleId => {
  const sale = sales.find(s => s.id === saleId);
  const [itemsSnap, paymentsSnap] = await Promise.all([
    getDocs(query(collection(db, 'articulosVenta'), where('ventaId', '==', saleId))),
    getDocs(query(collection(db, 'abonos'), where('ventaId', '==', saleId)))
  ]);
  const items = itemsSnap.docs.map(d => d.data());
  const payments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  el('detailTitle').textContent = `${sale.numeroVenta} - ${sale.clienteNombre}`;
  el('saleDetail').innerHTML = `
    <div class="detail-grid">
      <div class="row">
        <div class="row-top">
          <strong>${sale.tipoVenta}</strong>
          <span class="badge ${sale.estado}">${sale.estado}</span>
        </div>
        <span class="muted">${dateText(toDate(sale.fechaVenta))}</span>
      </div>

      <div class="detail-section">
        <h4>Artículos</h4>
        ${items.map(i => `<div class="money-row"><span>${i.nombreArticulo} (${i.cantidad})</span><strong>${money(i.subtotal)}</strong></div>`).join('')}
      </div>

      <div class="detail-section">
        <h4>Resumen</h4>
        <div class="detail-summary">
          <div class="money-row"><span>Total</span><strong>${money(sale.total)}</strong></div>
          <div class="money-row"><span>Abonado</span><strong>${money(sale.totalAbonado)}</strong></div>
          <div class="money-row"><span>Saldo</span><strong>${money(sale.saldoPendiente)}</strong></div>
        </div>
      </div>

      <div class="detail-section">
        <h4>Abonos</h4>
        ${payments.length ? payments.map(p => `<div class="money-row"><span>${dateText(toDate(p.fechaAbono))} · ${p.metodoPago}</span><strong>${money(p.monto)}</strong></div>`).join('') : '<p class="muted">Sin abonos.</p>'}
      </div>

      <div class="actions">
        <button class="secondary" onclick="generatePdf('${sale.id}')">Generar PDF</button>
        <button class="danger" onclick="deleteSale('${sale.id}')">Eliminar venta</button>
      </div>
    </div>
  `;
  el('saleDialog').showModal();
};
el('closeDetail').addEventListener('click', () => el('saleDialog').close());

window.deleteSale = async saleId => {
  const confirmed = confirm('¿Está seguro de que desea eliminar esta venta?');
  if (!confirmed) return;

  const saleRef = doc(db, 'ventas', saleId);

  try {
    const [itemsSnap, paymentsSnap] = await Promise.all([
      getDocs(query(collection(db, 'articulosVenta'), where('ventaId', '==', saleId))),
      getDocs(query(collection(db, 'abonos'), where('ventaId', '==', saleId)))
    ]);
    const itemRefs = itemsSnap.docs.map(itemDoc => itemDoc.ref);
    const paymentRefs = paymentsSnap.docs.map(paymentDoc => paymentDoc.ref);

    await runTransaction(db, async tx => {
      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists()) throw new Error('La venta ya no existe o ya fue eliminada.');

      const itemSnapshots = [];
      for (const itemRef of itemRefs) {
        const itemSnap = await tx.get(itemRef);
        if (itemSnap.exists()) itemSnapshots.push({ ref: itemRef, data: itemSnap.data() });
      }

      const paymentSnapshots = [];
      for (const paymentRef of paymentRefs) {
        const paymentSnap = await tx.get(paymentRef);
        if (paymentSnap.exists()) paymentSnapshots.push({ ref: paymentRef });
      }

      const stockToRestore = new Map();
      itemSnapshots.forEach(({ data }) => {
        if (!data.productoId) throw new Error('Un artículo de la venta no tiene producto asociado.');
        const quantity = Number(data.cantidad || 0);
        if (quantity <= 0) throw new Error(`Cantidad inválida en el producto ${data.nombreArticulo || data.productoId}.`);
        stockToRestore.set(data.productoId, (stockToRestore.get(data.productoId) || 0) + quantity);
      });

      const productSnapshots = [];
      for (const [productId, quantity] of stockToRestore.entries()) {
        const productRef = doc(db, 'productos', productId);
        const productSnap = await tx.get(productRef);
        if (!productSnap.exists()) throw new Error(`El producto ${productId} ya no existe en inventario.`);
        productSnapshots.push({ ref: productRef, data: productSnap.data(), quantity });
      }

      productSnapshots.forEach(({ ref, data, quantity }) => {
        tx.update(ref, {
          stock: Number(data.stock || 0) + quantity,
          updatedAt: serverTimestamp()
        });
      });
      itemSnapshots.forEach(({ ref }) => tx.delete(ref));
      paymentSnapshots.forEach(({ ref }) => tx.delete(ref));
      tx.delete(saleRef);
    });

    if (el('saleDialog').open) el('saleDialog').close();
    await loadAll();
    alert('Venta eliminada correctamente y el inventario ha sido restaurado.');
  } catch (error) {
    console.error('Error al eliminar venta:', error);
    alert(`No se pudo eliminar la venta: ${error.message}`);
  }
};

window.addPaymentPrompt = saleId => {
  const sale = sales.find(s => s.id === saleId);
  if (!sale) return;

  paymentSaleId = saleId;
  el('paymentSaleTotal').textContent = money(sale.total);
  el('paymentTotalPaid').textContent = money(sale.totalAbonado);
  el('paymentBalance').textContent = money(sale.saldoPendiente);
  el('paymentDate').value = inputDateText(new Date());
  el('paymentAmount').value = '';
  el('paymentNotes').value = '';
  el('paymentMethodDialog').value = 'Efectivo';
  el('paymentDialog').showModal();
  setTimeout(() => el('paymentAmount').focus(), 50);
};

function closePaymentDialog() {
  paymentSaleId = null;
  el('paymentDialog').close();
}

el('closePayment').addEventListener('click', closePaymentDialog);
el('cancelPayment').addEventListener('click', closePaymentDialog);

el('paymentForm').addEventListener('submit', async event => {
  event.preventDefault();

  const sale = sales.find(s => s.id === paymentSaleId);
  if (!sale) return;

  const button = event.target.querySelector('button[type="submit"]');
  const amount = Number(el('paymentAmount').value || 0);
  if (!amount || amount <= 0) return alert('Ingrese un monto mayor a cero.');
  if (amount > Number(sale.saldoPendiente)) return alert('El abono no puede ser mayor al saldo.');

  button.disabled = true;
  button.textContent = 'Registrando...';

  const method = el('paymentMethodDialog').value;
  const newPaid = Number(sale.totalAbonado) + amount;
  const newBalance = Math.max(Number(sale.total) - newPaid, 0);

  try {
    await addDoc(collection(db, 'abonos'), {
      ventaId: paymentSaleId,
      fechaAbono: Timestamp.fromDate(new Date(el('paymentDate').value + 'T12:00:00')),
      monto: amount,
      metodoPago: method,
      numeroComprobante: '',
      observaciones: el('paymentNotes').value.trim(),
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'ventas', paymentSaleId), {
      totalAbonado: newPaid,
      saldoPendiente: newBalance,
      estado: saleStatus(newBalance, toDate(sale.fechaLimite)),
      updatedAt: serverTimestamp()
    });

    closePaymentDialog();
    await loadAll();
  } catch (error) {
    console.error('Error al registrar abono:', error);
    alert(`No se pudo registrar el abono: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Registrar abono';
  }
});

window.generatePdf = async saleId => {
  const sale = sales.find(s => s.id === saleId);
  if (!sale) return alert('No se encontró la venta.');

  const paymentsSnap = await getDocs(query(collection(db, 'abonos'), where('ventaId', '==', saleId)));
  const salePayments = paymentsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(a.fechaAbono)?.getTime() || 0) - (toDate(b.fechaAbono)?.getTime() || 0));
  const lastPayment = salePayments[salePayments.length - 1];
  const paymentDate = lastPayment ? toDate(lastPayment.fechaAbono) : toDate(sale.fechaVenta);
  const totalPaid = salePayments.reduce((sum, payment) => sum + Number(payment.monto || 0), 0) || Number(sale.totalAbonado || 0);
  const balance = Math.max(Number(sale.total || 0) - totalPaid, 0);
  const isCashSale = sale.tipoVenta === 'Contado';

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  const left = 14;
  const tableWidth = pageWidth - (left * 2);
  const navy = [6, 64, 130];
  const orange = [255, 108, 34];
  const softBlue = [242, 248, 255];
  const borderBlue = [211, 225, 241];
  const green = [0, 157, 76];
  const pdfMoney = value => new Intl.NumberFormat('es-CR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

  const drawText = (text, x, y, options = {}) => pdf.text(String(text || ''), x, y, options);
  const roundedBox = (x, y, width, height, fill, stroke = fill, radius = 4) => {
    pdf.setFillColor(...fill);
    pdf.setDrawColor(...stroke);
    pdf.roundedRect(x, y, width, height, radius, radius, 'FD');
  };
  const drawCheck = (x, y, size, color = [255, 255, 255]) => {
    pdf.setDrawColor(...color);
    pdf.setLineWidth(1.25);
    pdf.line(x - size * .42, y, x - size * .1, y + size * .32);
    pdf.line(x - size * .1, y + size * .32, x + size * .48, y - size * .36);
  };
  const drawIcon = (label, x, y) => {
    pdf.setFillColor(...navy);
    pdf.circle(x, y, 4.2, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    drawText(label, x, y + 2.1, { align: 'center' });
  };
  const drawMoney = (value, rightX, y) => {
    const amount = pdfMoney(value);
    drawText(`CRC ${amount}`, rightX, y, { align: 'right' });
  };
  const loadLogo = () => new Promise(resolve => {
    const logo = new Image();
    logo.onload = () => resolve(logo);
    logo.onerror = () => resolve(null);
    logo.src = 'img/Logo.png';
  });

  const logo = await loadLogo();
  if (logo) pdf.addImage(logo, 'PNG', centerX - 36, 8, 72, 53, undefined, 'FAST');

  pdf.setTextColor(...navy);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(21);
  drawText(isCashSale ? 'COMPROBANTE DE VENTA' : 'COMPROBANTE DE ABONO', centerX, 70, { align: 'center' });
  pdf.setTextColor(...orange);
  pdf.setFontSize(16);
  drawText(isCashSale ? 'AL CONTADO' : 'REGISTRO DE PAGO', centerX, 79, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  pdf.setTextColor(55, 88, 145);
  drawText(isCashSale ? 'Registro de compra realizada en su totalidad' : 'Registro de abono realizado', centerX, 87, { align: 'center' });

  roundedBox(left, 96, tableWidth, 45, softBlue, softBlue, 4);
  const status = isCashSale ? 'PAGADO' : saleStatus(balance, toDate(sale.fechaLimite)).toUpperCase();
  const infoRows = [
    ['C', 'Cliente:', sale.clienteNombre || 'Sin cliente'],
    ['F', 'Fecha:', dateText(paymentDate)],
    ['E', 'Estado:', status]
  ];
  infoRows.forEach(([icon, label, value], index) => {
    const rowY = 107 + index * 11;
    drawIcon(icon, left + 11, rowY - 1.4);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10.5);
    pdf.setTextColor(47, 82, 140);
    drawText(label, left + 20, rowY, { align: 'left' });
    if (index === 2) {
      const isPaid = status === 'PAGADO';
      roundedBox(left + 60, rowY - 7, 41, 11, isPaid ? [213, 248, 224] : [228, 239, 255], isPaid ? [213, 248, 224] : [228, 239, 255], 5);
      if (isPaid) drawCheck(left + 68, rowY - 1.5, 4, green);
      pdf.setTextColor(...(isPaid ? green : navy));
      pdf.setFont('helvetica', 'bold');
      drawText(value, left + 81, rowY, { align: 'center' });
    } else {
      pdf.setTextColor(...navy);
      pdf.setFont('helvetica', 'bold');
      drawText(value, left + 60, rowY, { align: 'left' });
    }
  });

  const paymentRows = isCashSale
    ? [
        ['Total de la venta', Number(sale.total || 0)],
        ['Monto pagado', Number(sale.total || 0)],
        ['Saldo pendiente', 0]
      ]
    : [
        ['Total de la venta', Number(sale.total || 0)],
        ['Total abonado', totalPaid],
        ['Saldo pendiente', balance]
      ];
  const summaryY = 148;
  roundedBox(left, summaryY, tableWidth, 13, navy, navy, 3);
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  drawText('RESUMEN DE PAGO', left + 8, summaryY + 8.5);

  const headerY = summaryY + 13;
  pdf.setFillColor(230, 239, 249);
  pdf.setDrawColor(...borderBlue);
  pdf.rect(left, headerY, tableWidth, 13, 'FD');
  const dividerX = left + tableWidth * .66;
  pdf.setFontSize(10);
  pdf.setTextColor(...navy);
  drawText('Concepto', left + 8, headerY + 8.5);
  drawText('Monto', left + tableWidth - 8, headerY + 8.5, { align: 'right' });

  paymentRows.forEach(([label, value], index) => {
    const y = headerY + 13 + index * 14;
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...borderBlue);
    pdf.rect(left, y, tableWidth, 14, 'FD');
    pdf.line(dividerX, y, dividerX, y + 14);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10.5);
    pdf.setTextColor(52, 84, 140);
    drawText(label, left + 8, y + 9);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...navy);
    drawMoney(value, left + tableWidth - 8, y + 9);
  });

  const noticeY = headerY + 13 + paymentRows.length * 14 + 10;
  const isPaid = balance <= 0;
  roundedBox(left, noticeY, tableWidth, 22, isPaid ? [239, 253, 244] : [239, 246, 255], isPaid ? [186, 239, 205] : [195, 221, 255], 3);
  pdf.setFillColor(...(isPaid ? [0, 166, 81] : navy));
  pdf.rect(left, noticeY, 3, 22, 'F');
  pdf.setFillColor(...(isPaid ? [0, 166, 81] : navy));
  pdf.circle(left + 16, noticeY + 11, 7, 'F');
  if (isPaid) drawCheck(left + 16, noticeY + 10.5, 5);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(...(isPaid ? green : navy));
  drawText(isPaid ? 'Venta pagada en su totalidad' : 'Abono registrado correctamente', left + 30, noticeY + 13);

  const footerY = Math.max(noticeY + 43, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(...navy);
  drawText(isCashSale ? 'Gracias por su compra.' : 'Gracias por su abono.', centerX, footerY, { align: 'center' });
  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(9.5);
  pdf.setTextColor(55, 88, 145);
  drawText(isCashSale ? 'Conserve este comprobante como respaldo de su compra.' : 'Conserve este comprobante como respaldo de su pago.', centerX, footerY + 9, { align: 'center' });

  pdf.save(`${sale.numeroVenta}-${isCashSale ? 'comprobante-contado' : 'comprobante-abono'}.pdf`);
};

loadAll().catch(error => alert(error.message));

