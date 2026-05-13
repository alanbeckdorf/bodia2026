const tableBody = document.getElementById('leadsTableBody');
const tableMeta = document.getElementById('tableMeta');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const logoutBtn = document.getElementById('logoutBtn');

let leads = [];

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value));
  } catch (_) {
    return value;
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source || source === 'hero' || source === 'cta' || source === 'website' || source === 'landing') {
    return 'Landing';
  }
  return source;
}

function statusLabel(status) {
  if (status === 'contacted') return 'Contactado';
  if (status === 'qualified') return 'Calificado';
  return 'Nuevo';
}

function badgeClass(status) {
  if (status === 'contacted') return 'badge-contacted';
  if (status === 'qualified') return 'badge-qualified';
  return 'badge-new';
}

function setStats(stats) {
  document.getElementById('statTotal').textContent = stats.total || 0;
  document.getElementById('statNew').textContent = stats.newCount || 0;
  document.getElementById('statContacted').textContent = stats.contacted || 0;
  document.getElementById('statQualified').textContent = stats.qualified || 0;
}

function getFilters() {
  return {
    query: (searchInput.value || '').trim().toLowerCase(),
    status: statusFilter.value
  };
}

function getFilteredLeads() {
  const { query, status } = getFilters();
  return leads.filter((lead) => {
    const matchesQuery =
      !query ||
      lead.email.toLowerCase().includes(query) ||
      formatSource(lead.source).toLowerCase().includes(query);
    const matchesStatus = status === 'all' || lead.status === status;
    return matchesQuery && matchesStatus;
  });
}

function renderTable() {
  const rows = getFilteredLeads();
  tableMeta.textContent = `${rows.length} resultado${rows.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">Todavía no hay registros para este filtro.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = rows.map((lead) => `
    <tr>
      <td>
        <div class="lead-email">${escapeHtml(lead.email)}</div>
        <div class="lead-meta">${escapeHtml(lead.ip || 'sin IP')}</div>
      </td>
      <td>${escapeHtml(formatDate(lead.createdAt))}</td>
      <td>${escapeHtml(formatSource(lead.source))}</td>
      <td class="status-cell">
        <div class="status-inline">
          <span class="badge-status ${badgeClass(lead.status)}">${statusLabel(lead.status)}</span>
          <select data-field="status" data-id="${lead.id}">
          <option value="new" ${lead.status === 'new' ? 'selected' : ''}>Nuevo</option>
          <option value="contacted" ${lead.status === 'contacted' ? 'selected' : ''}>Contactado</option>
          <option value="qualified" ${lead.status === 'qualified' ? 'selected' : ''}>Calificado</option>
          </select>
        </div>
      </td>
      <td>
        <textarea data-field="observation" data-id="${lead.id}" placeholder="Observación rápida">${escapeHtml(lead.observation || '')}</textarea>
      </td>
      <td>
        <textarea data-field="notes" data-id="${lead.id}" placeholder="Notas internas">${escapeHtml(lead.notes || '')}</textarea>
      </td>
      <td>
        <button class="btn btn-dark btn-save" data-save-id="${lead.id}">Guardar</button>
      </td>
      <td>
        <button class="btn btn-danger btn-delete" data-delete-id="${lead.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

async function fetchLeads() {
  const response = await fetch('/api/admin/leads', { credentials: 'include' });
  if (response.status === 401) {
    window.location.replace('/admin');
    return;
  }
  const data = await response.json();
  leads = Array.isArray(data.leads) ? data.leads : [];
  setStats(data.stats || {});
  renderTable();
}

async function checkSession() {
  const response = await fetch('/api/admin/session', { credentials: 'include' });
  if (!response.ok) {
    window.location.replace('/admin');
    return;
  }
  await fetchLeads();
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/admin/logout', {
    method: 'POST',
    credentials: 'include'
  });
  window.location.replace('/admin');
});

searchInput.addEventListener('input', renderTable);
statusFilter.addEventListener('change', renderTable);

tableBody.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('[data-delete-id]');
  if (deleteButton) {
    const leadId = deleteButton.dataset.deleteId;
    const confirmed = window.confirm('¿Eliminar este lead? Esta acción no se puede deshacer.');
    if (!confirmed) return;

    deleteButton.disabled = true;
    deleteButton.textContent = 'Eliminando...';

    const deleteResponse = await fetch(`/api/admin/leads/${leadId}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (deleteResponse.ok) {
      leads = leads.filter((lead) => lead.id !== leadId);
      renderTable();
      await fetchLeads();
      return;
    }

    let errorMessage = 'No se pudo eliminar el lead.';
    try {
      const errorData = await deleteResponse.json();
      if (errorData?.error) errorMessage = errorData.error;
    } catch (_) {
      // noop
    }

    deleteButton.disabled = false;
    deleteButton.textContent = 'Eliminar';
    window.alert(errorMessage);
    return;
  }

  const saveButton = event.target.closest('[data-save-id]');
  if (!saveButton) return;

  const leadId = saveButton.dataset.saveId;
  const status = tableBody.querySelector(`[data-field="status"][data-id="${leadId}"]`)?.value || 'new';
  const observation = tableBody.querySelector(`[data-field="observation"][data-id="${leadId}"]`)?.value || '';
  const notes = tableBody.querySelector(`[data-field="notes"][data-id="${leadId}"]`)?.value || '';

  saveButton.disabled = true;
  saveButton.textContent = 'Guardando...';

  const response = await fetch(`/api/admin/leads/${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status, observation, notes })
  });

  if (response.ok) {
    await fetchLeads();
    return;
  }

  saveButton.disabled = false;
  saveButton.textContent = 'Guardar';
});

checkSession();
