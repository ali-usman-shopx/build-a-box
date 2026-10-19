
// @ts-nocheck

/* ---------------------------------------------------------
   BundleGridAddButton
   Dispatches product-add requests. Does not manage state.
--------------------------------------------------------- */

class BundleGridAddButton extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;

    this.input = this.querySelector('[data-quantity-input]');
    this.decreaseButton = this.querySelector('[data-quantity-decrease]');
    this.increaseButton = this.querySelector('[data-quantity-increase]');

    // Backward compatibility with the original Add to Bundle button.
    this.button = this.querySelector(
      'button:not([data-quantity-decrease]):not([data-quantity-increase])'
    );

    this.productData = () => {
      const price = Number(this.dataset.productPrice);

      const detail = {
        productId: this.dataset.productId || '',
        variantId: this.dataset.variantId || '',
        title: this.dataset.productTitle || '',
        price,
        image: this.dataset.productImage || '',
        url: this.dataset.productUrl || '',
      };

      if (
        !detail.variantId ||
        this.dataset.productPrice == null ||
        this.dataset.productPrice.trim() === '' ||
        !Number.isFinite(price)
      ) {
        console.warn(
          '[BundleGridAddButton] Invalid product data:',
          detail
        );
        return null;
      }

      return detail;
    };

    this.setQuantity = (value) => {
      if (!this.input || this.input.disabled) return;

      const quantity = Math.max(
        0,
        Number.isFinite(Number(value))
          ? Math.floor(Number(value))
          : 0
      );

      this.input.value = quantity;
      this.input.setAttribute('aria-valuenow', quantity);

      const detail = this.productData();
      if (!detail) return;

      this.dispatchEvent(
        new CustomEvent('bundle:grid:set-quantity', {
          bubbles: true,
          composed: true,
          detail: { ...detail, quantity },
        })
      );

      const title = detail.title || 'product';

      this.decreaseButton?.setAttribute(
        'aria-label',
        `Remove one ${title}. Current quantity: ${quantity}`
      );

      this.increaseButton?.setAttribute(
        'aria-label',
        `Add one ${title}. Current quantity: ${quantity}`
      );
    };

    this.onDecrease = () => {
      this.setQuantity(Number(this.input.value || 0) - 1);
    };

    this.onIncrease = () => {
      this.setQuantity(Number(this.input.value || 0) + 1);
    };

    this.onInputChange = () => {
      this.setQuantity(this.input.value);
    };

    this.onInput = () => {
      // Allow typing temporarily; normalize when editing is complete.
      if (this.input.value !== '' && Number(this.input.value) < 0) {
        this.input.value = 0;
      }
    };

    this.onClick = () => {
      if (!this.button || this.button.disabled) return;
      this.setQuantity(Number(this.input?.value || 0) + 1);
    };

    this.decreaseButton?.addEventListener('click', this.onDecrease);
    this.increaseButton?.addEventListener('click', this.onIncrease);
    this.input?.addEventListener('change', this.onInputChange);
    this.input?.addEventListener('input', this.onInput);
    this.button?.addEventListener('click', this.onClick);
  }

  disconnectedCallback() {
    this.decreaseButton?.removeEventListener('click', this.onDecrease);
    this.increaseButton?.removeEventListener('click', this.onIncrease);
    this.input?.removeEventListener('change', this.onInputChange);
    this.input?.removeEventListener('input', this.onInput);
    this.button?.removeEventListener('click', this.onClick);

    this.initialized = false;
  }

  syncQuantityFromBundle(quantity) {
    if (!this.input) return;
  
    const normalizedQuantity = Math.max(
      0,
      Math.floor(Number(quantity) || 0)
    );
  
    this.input.value = String(normalizedQuantity);
  }
}

if (!customElements.get('bundle-grid-add-button')) {
  customElements.define('bundle-grid-add-button', BundleGridAddButton);
}


/* ---------------------------------------------------------
   BundleGrid
   Owns bundle state, calculations, and discount tiers.

   Drawer visibility is handled by BundleGridSummary, so
   this class no longer needs a separate trigger or overlay.
--------------------------------------------------------- */

class BundleGrid extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;

    if (!this.stateInitialized) {
      this.items = [];
      this.stateInitialized = true;
    }

    this.initProductSidebar();

    this.discountTiers = [];

    this.recalculateBundle();
    this.waitForBundler();

    this.onAddItem = (event) => {
      this.addItem(event.detail);
      event.stopPropagation();
    };

    this.onSetQuantity = (event) => {
      this.setItemQuantity(event.detail);
      event.stopPropagation();
    };

    this.addEventListener(
      'bundle:grid:set-quantity',
      this.onSetQuantity
    );

    this.addEventListener('bundle:grid:add-item', this.onAddItem);
  }

  disconnectedCallback() {
    this.removeEventListener('bundle:grid:add-item', this.onAddItem);
    this.removeEventListener(
      'bundle:grid:set-quantity',
      this.onSetQuantity
    );
    
    this.removeEventListener(
      'click',
      this.onProductSidebarClick
    );
    document.removeEventListener(
      'keydown',
      this.onProductSidebarKeydown
    );
    
    this.initialized = false;
  }

  addItem(product) {
    if (
      !product?.variantId ||
      !Number.isFinite(product.price)
    ) {
      console.warn(
        '[BundleGrid] Invalid product; not added:',
        product
      );
      return;
    }

    const variantId = String(product.variantId);

    const existingItem = this.items.find(
      (item) => item.variantId === variantId
    );

    if (existingItem) {
      this.items = this.items.map((item) =>
        item.variantId === variantId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    } else {
      this.items = [
        ...this.items,
        {
          productId: String(product.productId || ''),
          variantId,
          title: product.title || '',
          price: product.price,
          image: product.image || '',
          url: product.url || '',
          quantity: 1,
        },
      ];
    }

    this.recalculateBundle();

    this.dispatchEvent(
      new CustomEvent('bundle:grid:item-added', {
        bubbles: true,
        detail: {
          variantId,
          items: this.getBundleState().items,
        },
      })
    );
  }

  removeItem(variantId, quantity = Infinity) {
    const id = String(variantId);

    const item = this.items.find(
      (entry) => entry.variantId === id
    );

    if (!item || !(quantity > 0)) return;

    if (quantity >= item.quantity) {
      this.items = this.items.filter(
        (entry) => entry.variantId !== id
      );
    } else {
      this.items = this.items.map((entry) =>
        entry.variantId === id
          ? { ...entry, quantity: entry.quantity - quantity }
          : entry
      );
    }

    this.recalculateBundle();
  }

  syncProductQuantities() {
    if (!Array.isArray(this.items)) return;
  
    this.querySelectorAll('bundle-grid-add-button').forEach((picker) => {
      const item = this.items.find(
        (item) =>
          String(item.variantId) === String(picker.dataset.variantId)
      );
  
      picker.syncQuantityFromBundle(item?.quantity ?? 0);
    });
  }

  setItemQuantity(detail) {
    const { variantId, quantity } = detail;

    const index = this.items.findIndex(
        (item) => String(item.variantId) === String(variantId)
    );

    if (quantity === 0) {
        if (index !== -1) {
        this.items.splice(index, 1);
        }
    } else if (index !== -1) {
        this.items[index].quantity = quantity;
    } else {
        this.items.push({ ...detail, quantity });
    }

    this.recalculateBundle();
  }

  waitForBundler() {
    const startedAt = Date.now();

    const loadTiers = () => {
      const bundles = window.bndlr?.getBundles?.();

      if (!Array.isArray(bundles)) {
        if (Date.now() - startedAt < 15000) {
          setTimeout(loadTiers, 250);
        } else {
          console.warn(
            '[BundleGrid] Bundler API did not return bundles.'
          );
        }

        return;
      }

      const bundle = bundles.find(
        (item) => String(item.id) === '880995'
      );

      if (!bundle) {
        console.warn('[BundleGrid] Bundle 880995 not found.');
        return;
      }

      this.discountTiers = this.getBundlerDiscountTiers(880995);
      this.recalculateBundle();
    };

    loadTiers();
  }

  getBundlerDiscountTiers(bundleId) {
    const bundles = window.bndlr?.getBundles?.();

    if (!Array.isArray(bundles)) return [];

    const bundle = bundles.find(
      (item) => String(item.id) === String(bundleId)
    );

    if (!bundle || bundle.status !== 'enabled') return [];

    return (bundle.volume_discounts || [])
      .filter((tier) => tier.range_type === 'min_cart_value')
      .map((tier) => ({
        minimumAmount: Number(tier.min_cart_value),
        minimumItems: Number(tier.min_items) || 0,
        discountType: tier.discount_type,
        discountValue: Number(tier.discount_value),
      }))
      .sort((a, b) => a.minimumAmount - b.minimumAmount);
  }

  calculateDiscountRate(totalPrice, items, tiers) {
    const totalAmount = totalPrice / 100;

    const totalItems = items.reduce(
      (total, item) => total + item.quantity,
      0
    );

    const eligibleTiers = tiers.filter(
      (tier) =>
        totalAmount >= tier.minimumAmount &&
        totalItems >= tier.minimumItems
    );

    const tier = eligibleTiers.at(-1);

    if (!tier || tier.discountType !== 'percentage') {
      return 0;
    }

    return tier.discountValue / 100;
  }

  recalculateBundle() {
    this.items = this.items.map((item) => ({
      ...item,
      lineTotal: item.price * item.quantity,
    }));

    this.totalItems = this.items.reduce(
      (total, item) => total + item.quantity,
      0
    );

    // Prices are stored in Shopify's smallest currency unit.
    this.totalPrice = this.items.reduce(
      (total, item) => total + item.lineTotal,
      0
    );

    this.discountRate = this.calculateDiscountRate(
      this.totalPrice,
      this.items,
      this.discountTiers
    );

    this.discountAmount = Math.round(
      this.totalPrice * this.discountRate
    );

    this.discountedPrice = this.totalPrice - this.discountAmount;

    const state = this.getBundleState();

    this.syncProductQuantities();

    this.dispatchEvent(
      new CustomEvent('bundle:grid:updated', {
        bubbles: true,
        detail: state,
      })
    );
  }

  getBundleState() {
    return {
      items: this.items.map((item) => ({ ...item })),
      totalItems: this.totalItems,
      totalPrice: this.totalPrice,
      discountRate: this.discountRate,
      discountAmount: this.discountAmount,
      discountedPrice: this.discountedPrice,
    };
  }

  initProductSidebar() {
    this.productSidebar = this.querySelector('[data-product-sidebar]');
    this.productSidebarBackdrop = this.querySelector(
        '[data-product-sidebar-backdrop]'
    );
    this.productSidebarTitle = this.querySelector(
        '[data-product-sidebar-title]'
    );
    this.productSidebarImage = this.querySelector(
        '[data-product-sidebar-image]'
    );

    this.productSidebarDescription = this.querySelector(
        '[data-product-sidebar-description]'
    );

    this.productSidebarClose = this.querySelector(
        '[data-product-sidebar-close]'
    );

    if (
        !this.productSidebar ||
        !this.productSidebarBackdrop ||
        !this.productSidebarTitle ||
        !this.productSidebarImage ||
        !this.productSidebarDescription ||
        !this.productSidebarClose
    ) {
        return;
    }

    this.onProductSidebarClick = (event) => {
        const infoButton = event.target.closest(
        '[data-product-info-url]'
        );

        if (infoButton && this.contains(infoButton)) {
        this.openProductSidebar(infoButton);
        return;
        }

        if (
        event.target.closest('[data-product-sidebar-close]') ||
        event.target === this.productSidebarBackdrop
        ) {
        this.closeProductSidebar();
        }
    };

    this.onProductSidebarKeydown = (event) => {
        if (
        event.key === 'Escape' &&
        this.productSidebar.classList.contains('is-open')
        ) {
        this.closeProductSidebar();
        }
    };

    this.addEventListener('click', this.onProductSidebarClick);
    document.addEventListener('keydown', this.onProductSidebarKeydown);
  }

    async openProductSidebar(button) {
        const sidebar = this.productSidebar;
        const productUrl = button.dataset.productInfoUrl;

        this.lastProductInfoButton = button;

        this.productSidebarTitle.textContent = 'Loading…';
        this.productSidebarDescription.replaceChildren();
        this.productSidebarImage.hidden = true;
        this.productSidebarImage.removeAttribute('src');
        this.productSidebarImage.alt = '';

        sidebar.classList.add('is-open');
        sidebar.setAttribute('aria-hidden', 'false');
        sidebar.inert = false;

        this.productSidebarBackdrop.hidden = false;
        this.productSidebarClose.focus();

        const requestId = (this.productSidebarRequestId || 0) + 1;
        this.productSidebarRequestId = requestId;

        try {
            const response = await fetch(
            `${productUrl.replace(/\/$/, '')}.js`
            );

            if (!response.ok) {
            throw new Error(`Product request failed: ${response.status}`);
            }

            const product = await response.json();

            if (
            requestId !== this.productSidebarRequestId ||
            !sidebar.classList.contains('is-open')
            ) {
            return;
            }

            this.productSidebarTitle.textContent = product.title || '';
            this.productSidebarDescription.innerHTML = product.description || '';

            if (product.featured_image) {
            this.productSidebarImage.src = product.featured_image;
            this.productSidebarImage.alt = product.title || '';
            this.productSidebarImage.hidden = false;
            }
        } catch (error) {
            if (requestId !== this.productSidebarRequestId) return;

            this.productSidebarTitle.textContent =
            'Unable to load product details.';

            this.productSidebarDescription.replaceChildren();

            console.error(
            '[BundleGrid] Could not load product details:',
            error
            );
        }
    }

    closeProductSidebar() {
      if (!this.productSidebar) return;
  
      this.productSidebarRequestId =
          (this.productSidebarRequestId || 0) + 1;
  
      this.productSidebar.classList.remove('is-open');
      this.productSidebar.setAttribute('aria-hidden', 'true');
      this.productSidebar.inert = true;
  
      this.productSidebarBackdrop.hidden = true;
      this.lastProductInfoButton?.focus();
    }
}

if (!customElements.get('bundle-grid')) {
  customElements.define('bundle-grid', BundleGrid);
}


/* ---------------------------------------------------------
   BundleGridSummary
   Renders one summary for both desktop and mobile.

   Mobile:
   - Toggle expands/collapses the product list.
   - Totals and Next stay visible.
   - Escape collapses the list.
   - Resizing to desktop resets the expanded state.
--------------------------------------------------------- */

class BundleGridSummary extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;

    this.bundle = this.closest('bundle-grid');

    if (!this.bundle) {
      console.warn(
        '[BundleGridSummary] No parent <bundle-grid> found.',
        this
      );
      return;
    }

    this.itemsContainer = this.querySelector('[data-bundle-items]');
    this.totalItemsElement = this.querySelector('[data-bundle-total-items]');
    this.discountElement = this.querySelector('[data-bundle-discount]');
    this.subtotalElement = this.querySelector('[data-bundle-subtotal]');
    this.originalTotalElement = this.querySelector(
      '[data-bundle-original-total]'
    );
    this.nextButton = this.querySelector('[data-bundle-next]');

    this.toggleButton = this.querySelector('[data-bundle-toggle]');
    this.toggleLabel = this.querySelector('[data-bundle-toggle-label]');
    this.container = this.closest('.bundle-grid__bundle-container');

    if (!this.itemsContainer) {
      console.warn(
        '[BundleGridSummary] Missing [data-bundle-items] element.',
        this
      );
      return;
    }

    this.initialized = true;

    this.onBundleUpdated = (event) => {
      this.render(event.detail);
    };

    this.onItemAdded = () => {
      // The updated event performs the actual rendering.
    };

    this.onRemoveClick = (event) => {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const button = target.closest('[data-remove-variant]');

      if (!button || !this.itemsContainer.contains(button)) return;

      this.bundle.removeItem(button.dataset.removeVariant);
    };

    this.onNextClick = () => {
      const state = this.bundle.getBundleState();

      this.bundle.dispatchEvent(
        new CustomEvent('bundle:grid:next', {
          bubbles: true,
          detail: state,
        })
      );
    };

    this.onToggleClick = () => {
      const expanded = this.container?.classList.contains('is-expanded');

      this.setExpanded(!expanded);
    };

    this.onKeyDown = (event) => {
      if (event.key === 'Escape') {
        this.setExpanded(false);
      }
    };

    this.onResize = () => {
      if (window.matchMedia('(min-width: 750px)').matches) {
        this.setExpanded(false);
      }
    };

    this.bundle.addEventListener(
      'bundle:grid:updated',
      this.onBundleUpdated
    );

    this.bundle.addEventListener(
      'bundle:grid:item-added',
      this.onItemAdded
    );

    this.itemsContainer.addEventListener(
      'click',
      this.onRemoveClick
    );

    this.nextButton?.addEventListener(
      'click',
      this.onNextClick
    );

    this.toggleButton?.addEventListener(
      'click',
      this.onToggleClick
    );

    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);

    this.setExpanded(false);

    // The bundle may have emitted its initial update before
    // this summary finished connecting.
    this.render(this.bundle.getBundleState());
  }

  disconnectedCallback() {
    this.bundle?.removeEventListener(
      'bundle:grid:updated',
      this.onBundleUpdated
    );

    this.bundle?.removeEventListener(
      'bundle:grid:item-added',
      this.onItemAdded
    );

    this.itemsContainer?.removeEventListener(
      'click',
      this.onRemoveClick
    );

    this.nextButton?.removeEventListener(
      'click',
      this.onNextClick
    );

    this.toggleButton?.removeEventListener(
      'click',
      this.onToggleClick
    );

    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);

    this.initialized = false;
  }

  setExpanded(expanded) {
    if (!this.container) return;

    this.container.classList.toggle('is-expanded', expanded);

    this.toggleButton?.setAttribute(
      'aria-expanded',
      String(expanded)
    );

    if (this.toggleLabel) {
      this.toggleLabel.textContent = expanded
        ? 'Hide items'
        : 'Show items';
    }
  }

  formatMoney(amount) {
    if (
      typeof Shopify !== 'undefined' &&
      typeof Shopify.formatMoney === 'function' &&
      Shopify.money_format
    ) {
      return Shopify.formatMoney(amount, Shopify.money_format);
    }

    const currency =
      typeof Shopify !== 'undefined' && Shopify.currency?.active
        ? Shopify.currency.active
        : 'USD';

    return new Intl.NumberFormat(
      document.documentElement.lang || 'en',
      {
        style: 'currency',
        currency,
      }
    ).format(amount / 100);
  }

  escapeHTML(value) {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return String(value ?? '').replace(
      /[&<>"']/g,
      (character) => entities[character]
    );
  }

  render(state) {
    if (!state) return;

    const {
      items = [],
      totalItems = 0,
      totalPrice = 0,
      discountRate = 0,
      discountAmount = 0,
      discountedPrice = totalPrice,
    } = state;

    /* Render the single product list. */
    this.itemsContainer.replaceChildren();

    if (items.length === 0) {
      const empty = document.createElement('p');

      empty.className = 'bundle-grid-summary__empty';
      empty.textContent = 'Your box is empty. Add products to get started.';

      this.itemsContainer.appendChild(empty);
    } else {
      items.forEach((item) => {
        const discountedUnitPrice = Math.round(
          item.price * (1 - discountRate)
        );

        const imageMarkup = item.image
          ? `
            <img
              class="bundle-grid-summary__item-image"
              src="${this.escapeHTML(item.image)}"
              alt="${this.escapeHTML(item.title)}"
              loading="lazy"
              width="100"
              height="100"
            >
          `
          : `
            <span class="bundle-grid-summary__item-placeholder"></span>
          `;

        const originalPriceMarkup = discountRate > 0
          ? `
            <span class="bundle-grid-summary__item-original-price">
              <s>${this.formatMoney(item.price)}</s>
            </span>
          `
          : '';

        const row = document.createElement('div');
        row.className = 'bundle-grid-summary__item';

        row.innerHTML = `
          <div class="bundle-grid-summary__item-media">
            ${imageMarkup}

            <span
              class="bundle-grid-summary__quantity"
              aria-label="Quantity ${item.quantity}"
            >
              ${item.quantity}
            </span>

            <button
              type="button"
              class="bundle-grid-summary__remove"
              data-remove-variant="${this.escapeHTML(item.variantId)}"
              aria-label="Remove ${this.escapeHTML(item.title)} from your box"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  fill="currentColor"
                  d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                />
              </svg>
            </button>
          </div>

          <div class="bundle-grid-summary__item-title">
            ${this.escapeHTML(item.title)}
          </div>

          <div class="bundle-grid-summary__item-prices">
            ${originalPriceMarkup}

            <span class="bundle-grid-summary__item-current-price ${
              discountRate > 0 ? 'is-discounted' : ''
            }">
              ${this.formatMoney(discountedUnitPrice)}
            </span>
          </div>
        `;

        this.itemsContainer.appendChild(row);
      });
    }

    /* Update the one shared set of totals. */
    if (this.totalItemsElement) {
      this.totalItemsElement.textContent = totalItems;
    }

    if (this.discountElement) {
      this.discountElement.textContent = this.formatMoney(discountAmount);
    }

    if (this.subtotalElement) {
      this.subtotalElement.textContent = this.formatMoney(discountedPrice);

      this.subtotalElement.classList.toggle(
        'is-discounted',
        discountRate > 0
      );
    }

    /*
      The original total appears only when a discount applies.
      Both values use the same state as the product list.
    */
    if (this.originalTotalElement) {
      this.originalTotalElement.textContent = this.formatMoney(totalPrice);
      this.originalTotalElement.hidden = discountRate <= 0;
    }

    if (this.nextButton) {
      this.nextButton.disabled = totalItems === 0;
    }

    Object.assign(this.dataset, {
      totalItems,
      totalPrice,
      discountRate,
      discountAmount,
      discountedPrice,
    });
  }
}

if (!customElements.get('bundle-grid-summary')) {
  customElements.define('bundle-grid-summary', BundleGridSummary);
}

/* ---------------------------------------------------------
   Integration Tests
--------------------------------------------------------- */

(() => {
  const results = [];

  const assert = (name, condition) => {
    results.push({ test: name, passed: Boolean(condition) });
    console[condition ? 'log' : 'error'](
      `${condition ? 'PASS' : 'FAIL'}: ${name}`
    );
  };

  const bundle = document.createElement('bundle-grid');
  const summary = document.createElement('bundle-grid-summary');

  summary.innerHTML = `
    <div data-bundle-items></div>
    <span data-bundle-total-items></span>
    <span data-bundle-discount></span>
    <span data-bundle-subtotal></span>
    <button type="button" data-bundle-next></button>
  `;

  bundle.appendChild(summary);
  document.body.appendChild(bundle);

  let updateCount = 0;
  const onUpdated = () => updateCount++;

  bundle.addEventListener('bundle:grid:updated', onUpdated);

  const addButton = document.createElement('bundle-grid-add-button');

  Object.assign(addButton.dataset, {
    productId: 'test-product',
    variantId: 'test-variant',
    productTitle: 'Test Product',
    productPrice: '1000',
    productImage: '',
    productUrl: '/products/test-product',
  });

  addButton.innerHTML = '<button type="button">Add</button>';
  bundle.appendChild(addButton);

  // Test the real click -> custom event -> bundle mutation flow.
  addButton.querySelector('button').click();

  assert(
    'Add click inserts one variant',
    bundle.items.length === 1 &&
      bundle.items[0].variantId === 'test-variant'
  );

  assert(
    'Adding updates item count and subtotal',
    bundle.totalItems === 1 && bundle.totalPrice === 1000
  );

  assert(
    'Summary renders the added product',
    summary.querySelectorAll('.bundle-grid-summary__item').length === 1
  );

  assert(
    'Summary displays the correct item count',
    summary.querySelector('[data-bundle-total-items]').textContent === '1'
  );

  assert('Bundle update event was dispatched', updateCount === 1);

  // Adding the same variant should increment quantity, not create a new row.
  addButton.querySelector('button').click();

  assert(
    'Adding the same variant increments quantity',
    bundle.items.length === 1 && bundle.items[0].quantity === 2
  );

  assert(
    'Quantity is reflected in the summary',
    summary.querySelector('.bundle-grid-summary__quantity').textContent.trim() === '2'
  );

  // The summary's remove button should mutate BundleGrid state.
  summary.querySelector('[data-remove-variant]').click();

  assert(
    'Remove button clears the variant',
    bundle.items.length === 0 && bundle.totalItems === 0
  );

  assert(
    'Summary returns to its empty state',
    Boolean(summary.querySelector('.bundle-grid-summary__empty'))
  );

  bundle.removeEventListener('bundle:grid:updated', onUpdated);
  bundle.remove();

  console.table(results);

  const failed = results.filter((result) => !result.passed);
  console.log(`${results.length - failed.length}/${results.length} tests passed.`);

  return { results, passed: failed.length === 0 };
})();

