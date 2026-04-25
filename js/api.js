const API_URL = 'https://script.google.com/macros/s/AKfycbxqgxkA8b18rkKwGzrAUszM87i5WA5U0xc0RGzjbrB9AVvj3E8a1DDJAEKk06eWKso/exec';

async function apiCall(action, data = {}) {
  try {
    const token = localStorage.getItem('adminToken');
    const classCode = localStorage.getItem('currentClassCode');
    
    const payload = { action, ...data };
    
    if (token) payload.token = token;
    if (classCode) payload.classCode = classCode;

    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return await response.json();
  } catch (err) {
    console.error(`[API] ${action} failed:`, err);
    return { success: false, message: "Server connection failed." };
  }
}