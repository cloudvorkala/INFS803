/* ---------------------------------------------------------------------------
   Cart state.

   The cart lives on the server (GET/POST/DELETE /cart) so it survives a device
   change — the assignment's three-tier requirement means the client should not
   be the source of truth. This context just caches the last server response and
   re-fetches whenever the signed-in user changes.
   --------------------------------------------------------------------------- */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as api from '../services/apiClient.js';
import { useAuth } from './AuthContext.jsx';

const CartContext = createContext(null);

const EMPTY = { items: [], itemCount: 0, total: 0 };

export function CartProvider({ children }) {
  const { user } = useAuth();
  const [cart, setCart] = useState(EMPTY);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setCart(EMPTY);
      return;
    }
    setLoading(true);
    try {
      setCart(await api.getCart());
    } catch {
      setCart(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-user-change: refresh() sets loading before its request settles, per https://react.dev/learn/synchronizing-with-effects#fetching-data
    refresh();
  }, [refresh]);

  /** Add an item. Throws ApiError on out-of-stock (409) so the page can show it. */
  const addItem = useCallback(async (productId, quantity = 1) => {
    const updated = await api.addToCart(productId, quantity);
    setCart(updated);
    return updated;
  }, []);

  /** Set a line's quantity outright. 0 removes it. */
  const setItemQuantity = useCallback(async (productId, quantity) => {
    const updated = await api.updateCartItem(productId, quantity);
    setCart(updated);
    return updated;
  }, []);

  const removeItem = useCallback(async (productId) => {
    const updated = await api.removeFromCart(productId);
    setCart(updated);
    return updated;
  }, []);

  const placeOrder = useCallback(async (shippingAddress) => {
    const order = await api.checkout(shippingAddress);
    setCart(EMPTY);
    return order;
  }, []);

  return (
    <CartContext.Provider
      value={{ cart, loading, refresh, addItem, setItemQuantity, removeItem, placeOrder }}
    >
      {children}
    </CartContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook must live next to the context it reads
export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>.');
  return ctx;
}
