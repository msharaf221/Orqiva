/**
 * POS screen barrel.
 *
 * The original 3,457-line file is now split into focused modules under ./pos:
 *  - helpers        : POS types (PosProduct/CartItem/CheckoutResult), walk-in customer, sound
 *  - shift-modals   : Open / cash-movement / close shift modals
 *  - treasury-review: Treasury review list + shift handover slip
 *  - checkout       : Customer picker, discount, checkout & payment modals
 *  - receipt        : Thermal receipt modal
 *  - hotkeys        : Keyboard shortcuts modal
 *
 * Import path from App.tsx is preserved through this barrel.
 */
export { POS } from './pos/index';
