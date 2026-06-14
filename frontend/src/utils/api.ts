const API_BASE_URL = 'http://localhost:5001/api/v1';

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.map((cb) => cb(token));
  refreshSubscribers = [];
}

export const getTokens = () => {
  const accessToken = localStorage.getItem('accessToken');
  const refreshToken = localStorage.getItem('refreshToken');
  const userStr = localStorage.getItem('user');
  return {
    accessToken,
    refreshToken,
    user: userStr ? JSON.parse(userStr) : null,
  };
};

export const setTokens = (accessToken: string, refreshToken: string, user: any) => {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
  localStorage.setItem('user', JSON.stringify(user));
};

export const clearTokens = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
};

async function handleTokenRefresh(): Promise<string | null> {
  const { refreshToken } = getTokens();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      throw new Error('Refresh failed');
    }

    const data = await response.json();
    const currentTokens = getTokens();
    setTokens(data.accessToken, data.refreshToken, currentTokens.user);
    return data.accessToken;
  } catch (err) {
    clearTokens();
    window.location.href = '/login';
    return null;
  }
}

export async function apiRequest(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const url = `${API_BASE_URL}${path}`;
  const tokens = getTokens();

  const headers = new Headers(options.headers || {});
  if (tokens.accessToken) {
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  }

  const mergedOptions = {
    ...options,
    headers,
  };

  try {
    const response = await fetch(url, mergedOptions);

    if (response.status === 401) {
      // Check if it's token expiration error
      const clonedResponse = response.clone();
      let errorData = null;
      try {
        errorData = await clonedResponse.json();
      } catch (e) {
        // ignore
      }

      if (errorData && errorData.code === 'TOKEN_EXPIRED') {
        if (!isRefreshing) {
          isRefreshing = true;
          handleTokenRefresh().then((newToken) => {
            isRefreshing = false;
            if (newToken) {
              onRefreshed(newToken);
            }
          });
        }

        const retryOriginalRequest = new Promise((resolve) => {
          subscribeTokenRefresh((token: string) => {
            headers.set('Authorization', `Bearer ${token}`);
            resolve(fetch(url, mergedOptions).then((res) => res.json()));
          });
        });

        return retryOriginalRequest;
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorObj;
      try {
        errorObj = JSON.parse(errorText);
      } catch (e) {
        errorObj = { error: errorText };
      }
      throw new Error(errorObj.error || 'Request failed');
    }

    // Handles empty responses (like deletions)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    return null;
  } catch (error) {
    throw error;
  }
}

export const api = {
  get: (path: string) => apiRequest(path, { method: 'GET' }),
  post: (path: string, data: any) =>
    apiRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  postFormData: (path: string, formData: FormData) =>
    apiRequest(path, {
      method: 'POST',
      body: formData, // Browser sets Content-Type automatically with boundary
    }),
  put: (path: string, data: any) =>
    apiRequest(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  delete: (path: string) => apiRequest(path, { method: 'DELETE' }),
};
