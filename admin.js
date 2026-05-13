const loginForm = document.getElementById('loginForm');
const loginFeedback = document.getElementById('loginFeedback');

async function checkSession() {
  const response = await fetch('/api/admin/session', { credentials: 'include' });
  if (response.ok) {
    window.location.replace('/backoffice');
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginFeedback.textContent = '';

  const formData = new FormData(loginForm);
  const payload = {
    username: String(formData.get('username') || ''),
    password: String(formData.get('password') || '')
  };

  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    loginFeedback.textContent = data.error || 'No se pudo iniciar sesión.';
    return;
  }

  window.location.replace('/backoffice');
});

checkSession();
