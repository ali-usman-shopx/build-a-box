
// @ts-nocheck

class BundleGrid extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;

    this.trigger = this.querySelector('[data-drawer-open]');
    this.overlay = this.querySelector('[data-drawer-overlay]');
    this.drawer = this.querySelector('.bundle-grid__bundle-container');

    if (!this.trigger || !this.overlay || !this.drawer) return;

    this.onOpen = () => this.openDrawer();
    this.onOverlayClick = () => this.closeDrawer();
    this.onKeyDown = (event) => {
      if (event.key === 'Escape') this.closeDrawer();
    };

    this.trigger.addEventListener('click', this.onOpen);
    this.overlay.addEventListener('click', this.onOverlayClick);
    document.addEventListener('keydown', this.onKeyDown);

    this.onResize = () => {
      if (window.matchMedia('(min-width: 750px)').matches) {
        this.closeDrawer();
      }
    };

    window.addEventListener('resize', this.onResize);
  }

  disconnectedCallback() {
    this.trigger?.removeEventListener('click', this.onOpen);
    this.overlay?.removeEventListener('click', this.onOverlayClick);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
  }

  openDrawer() {
    this.classList.add('is-drawer-open');
    this.trigger?.setAttribute('aria-expanded', 'true');
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    this.closeButton = this.drawer?.querySelector(
      '[data-drawer-close], button'
    );

    this.closeButton?.focus();
  }

  closeDrawer() {
    if (!this.classList.contains('is-drawer-open')) return;

    this.classList.remove('is-drawer-open');
    this.trigger?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = this.previousOverflow || '';

    this.trigger?.focus();
  }
}

if (!customElements.get('bundle-grid')) {
  customElements.define('bundle-grid', BundleGrid);
}
