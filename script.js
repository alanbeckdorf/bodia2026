(() => {
  // ===== Year =====
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ===== Nav scroll state =====
  const nav = document.getElementById('nav');
  const onScroll = () => {
    if (window.scrollY > 8) nav.classList.add('is-scrolled');
    else nav.classList.remove('is-scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ===== Mobile nav toggle =====
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    links.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => links.classList.remove('open'))
    );
  }

  // ===== Reveal on scroll =====
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  document.querySelectorAll('.reveal, .reveal-feat').forEach((el) => io.observe(el));

  // ===== Email forms =====
  const toast = document.getElementById('toast');
  const showToast = () => {
    if (!toast) return;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4500);
  };

  const isValidEmail = (value) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim());

  const saveLead = (email, source) => {
    try {
      const key = 'bodia_leads';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.push({ email, source, ts: new Date().toISOString() });
      localStorage.setItem(key, JSON.stringify(list));
    } catch (_) {
      // noop
    }
  };

  const submitLead = async (email, source) => {
    const apiBase = window.BODIA_API_BASE || '';

    const response = await fetch(`${apiBase}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source })
    });

    if (!response.ok) {
      throw new Error('No pudimos guardar tu registro en este momento.');
    }

    return response.json();
  };

  // ===== Infinite marquee =====
  const marquee = document.querySelector('.marquee');
  const marqueeTrack = marquee?.querySelector('.marquee-track');
  const baseMarqueeGroup = marqueeTrack?.querySelector('.marquee-group');

  if (marquee && marqueeTrack && baseMarqueeGroup) {
    const fillMarquee = () => {
      const groups = Array.from(marqueeTrack.querySelectorAll('.marquee-group'));
      groups.slice(1).forEach((group) => group.remove());

      const groupWidth = baseMarqueeGroup.offsetWidth;
      const targetWidth = marquee.offsetWidth + groupWidth * 2;

      if (!groupWidth) return;

      let currentWidth = groupWidth;
      while (currentWidth < targetWidth) {
        const clone = baseMarqueeGroup.cloneNode(true);
        marqueeTrack.appendChild(clone);
        currentWidth += groupWidth;
      }
    };

    let offset = 0;
    let previousTime = null;
    let animationFrameId = null;
    const speed = 72;

    const tick = (time) => {
      if (previousTime === null) previousTime = time;
      const delta = (time - previousTime) / 1000;
      previousTime = time;

      const groupWidth = baseMarqueeGroup.offsetWidth;
      if (groupWidth > 0) {
        offset += speed * delta;
        if (offset >= groupWidth) offset -= groupWidth;
        marqueeTrack.style.transform = `translateX(${-offset}px)`;
      }

      animationFrameId = window.requestAnimationFrame(tick);
    };

    const startMarquee = () => {
      fillMarquee();
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
      previousTime = null;
      animationFrameId = window.requestAnimationFrame(tick);
    };

    startMarquee();
    window.addEventListener('resize', startMarquee);
    window.addEventListener('load', startMarquee);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') startMarquee();
    });
  }

  document.querySelectorAll('form[data-form]').forEach((form) => {
    const input = form.querySelector('input[type="email"]');
    const msg = form.querySelector('.form-msg');
    if (!input || !msg) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = (input.value || '').trim();
      msg.classList.remove('show', 'error');

      if (!isValidEmail(value)) {
        msg.textContent = 'Ingresa un correo válido.';
        msg.classList.add('show', 'error');
        input.focus();
        return;
      }

      try {
        await submitLead(value, form.dataset.form);
        saveLead(value, form.dataset.form);
        msg.textContent = '¡Gracias por unirte! Pronto te enviaremos novedades.';
        msg.classList.add('show');
        form.reset();
        showToast();
      } catch (error) {
        if (window.location.protocol === 'file:') {
          msg.textContent = 'Abre el sitio desde http://127.0.0.1:3000 para que el correo llegue al backoffice.';
        } else {
          msg.textContent = error.message || 'Ocurrió un error. Intenta otra vez.';
        }
        msg.classList.add('show', 'error');
      }
    });
  });

  // ===== Legal modals =====
  const backdrop = document.querySelector('[data-modal-backdrop]');
  const modals = Array.from(document.querySelectorAll('.legal-modal'));
  const openButtons = Array.from(document.querySelectorAll('[data-modal-open]'));
  const closeButtons = Array.from(document.querySelectorAll('[data-modal-close]'));
  let activeModal = null;

  const closeModal = () => {
    if (!activeModal) return;
    activeModal.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.style.overflow = '';
    activeModal = null;
  };

  const openModal = (id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modals.forEach((item) => { item.hidden = true; });
    modal.hidden = false;
    if (backdrop) backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    activeModal = modal;
    const closeBtn = modal.querySelector('[data-modal-close]');
    if (closeBtn) closeBtn.focus();
  };

  openButtons.forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(button.dataset.modalOpen);
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', closeModal);
  });

  if (backdrop) backdrop.addEventListener('click', closeModal);

  modals.forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ===== Features accordion + dots =====
  const phoneImg = document.getElementById('featurePhone');
  const featCards = Array.from(document.querySelectorAll('.feat-card'));
  const featDots = Array.from(document.querySelectorAll('.features-dot'));
  const featuresPhone = document.querySelector('.features-phone');
  let activeFeatureIndex = 0;

  const activateFeature = (index) => {
    const card = featCards[index];
    if (!card) return;
    activeFeatureIndex = index;

    featCards.forEach((item) => {
      item.classList.remove('is-open');
      item.setAttribute('aria-expanded', 'false');
    });
    card.classList.add('is-open');
    card.setAttribute('aria-expanded', 'true');

    featDots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));

    const newImg = card.dataset.img;
    if (newImg && phoneImg && phoneImg.getAttribute('src') !== newImg) {
      phoneImg.style.opacity = '0';
      setTimeout(() => {
        phoneImg.setAttribute('src', newImg);
        phoneImg.style.opacity = '1';
      }, 200);
    }
  };

  featCards.forEach((card, i) => {
    card.addEventListener('click', () => activateFeature(i));
  });
  featDots.forEach((dot, i) => {
    dot.addEventListener('click', () => activateFeature(i));
  });
  if (featCards.length) activateFeature(0);

  // Swipe support for mobile: left/right over phone mockup switches feature.
  if (featuresPhone && featCards.length > 1) {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    const minSwipeDistance = 40;

    featuresPhone.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchEndX = touch.clientX;
      touchEndY = touch.clientY;
    }, { passive: true });

    featuresPhone.addEventListener('touchmove', (event) => {
      const touch = event.changedTouches[0];
      touchEndX = touch.clientX;
      touchEndY = touch.clientY;
    }, { passive: true });

    featuresPhone.addEventListener('touchend', () => {
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;

      // Only handle mostly-horizontal gestures.
      if (Math.abs(deltaX) < minSwipeDistance || Math.abs(deltaX) < Math.abs(deltaY)) return;

      if (deltaX < 0) {
        const next = (activeFeatureIndex + 1) % featCards.length;
        activateFeature(next);
      } else {
        const prev = (activeFeatureIndex - 1 + featCards.length) % featCards.length;
        activateFeature(prev);
      }
    }, { passive: true });
  }

  // ===== Smooth scroll for in-page links =====
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      if (anchor.hasAttribute('data-modal-open')) return;
      const id = anchor.getAttribute('href');
      if (!id || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
