const API_URL = 'https://script.google.com/macros/s/AKfycbxqgxkA8b18rkKwGzrAUszM87i5WA5U0xc0RGzjbrB9AVvj3E8a1DDJAEKk06eWKso/exec';

async function apiCall(action, data = {}) {
  try {
    const token = localStorage.getItem('adminToken');
    const classCode = localStorage.getItem('currentClassCode');

    if (!/^[a-zA-Z0-9_-]+$/.test(action)) {
      return { success: false, message: "Invalid action." };
    }

    const payload = { action, ...data };

    if (token && /^[a-zA-Z0-9_-]+$/.test(token)) payload.token = token;
    if (classCode) payload.classCode = classCode;

    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return await response.json();
  } catch (err) {
    console.error(`[API] ${action} failed:`, err);
    return { success: false, message: "Server connection failed." };
  }
}