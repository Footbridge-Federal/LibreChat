import { useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { isTokenExpired, getTokenExpiration } from '~/utils/tokenUtils';
import { setTokenHeader, clearTokenHeader } from 'librechat-data-provider';
import axios from 'axios';
import store from '~/store';

export const useJwtAuth = () => {
  const [user, setUser] = useRecoilState(store.user);
  const [token, setToken] = useRecoilState(store.token);
  const navigate = useNavigate();
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRefreshingRef = useRef(false);

  const hardLogout = useCallback(() => {
    // Clear all auth state
    clearTokenHeader();
    setToken('');
    setUser(undefined);

    // Clear any scheduled refresh
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    // Build Keycloak logout URL and redirect
    const keycloakLogoutUrl = `${process.env.REACT_APP_KEYCLOAK_URL}/realms/${process.env.REACT_APP_KEYCLOAK_REALM}/protocol/openid-connect/logout?redirect_uri=${encodeURIComponent(window.location.origin + '/login')}`;
    window.location.href = keycloakLogoutUrl;
  }, [setToken, setUser]);

  const refreshToken = useCallback(async (): Promise<string | null> => {
    if (isRefreshingRef.current) {
      return null; // Single-flight refresh
    }

    isRefreshingRef.current = true;
    try {
      const response = await axios.post('/api/auth/refresh', {}, {
        withCredentials: true, // Send HttpOnly cookies
      });

      const newToken = response.data.token;
      if (newToken) {
        setTokenHeader(newToken);
        setToken(newToken);
        scheduleTokenRefresh(newToken);
        return newToken;
      }
      return null;
    } catch (error) {
      console.error('Token refresh failed:', error);
      hardLogout();
      return null;
    } finally {
      isRefreshingRef.current = false;
    }
  }, [setToken, hardLogout]);

  const scheduleTokenRefresh = useCallback((accessToken: string) => {
    const exp = getTokenExpiration(accessToken);
    if (!exp) return;

    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = exp - now;

    // Schedule refresh 60-120 seconds before expiry
    const refreshInSeconds = Math.max(timeUntilExpiry - 90, 5);

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = setTimeout(() => {
      refreshToken();
    }, refreshInSeconds * 1000);

    console.log(`Token refresh scheduled in ${refreshInSeconds} seconds`);
  }, [refreshToken]);

  const initializeAuth = useCallback(async () => {
    // Check if we have an in-memory token first
    if (token && !isTokenExpired(token)) {
      setTokenHeader(token);
      scheduleTokenRefresh(token);
      return true;
    }

    // Try to get a new token using refresh cookie
    try {
      const newToken = await refreshToken();
      if (newToken) {
        // User will be set by useUser hook after successful auth
        return true;
      }
    } catch (error) {
      console.log('Initial token refresh failed, user needs to login');
    }

    return false;
  }, [token, refreshToken, scheduleTokenRefresh]);

  return {
    isAuthenticated: !!user && !!token && !isTokenExpired(token),
    hardLogout,
    refreshToken,
    initializeAuth,
  };
};