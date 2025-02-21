// Cache of the user's options
const settings = {};
const settingsForm = document.getElementById("settingsForm");
const apiStatus = document.getElementById("apiStatus");
const tempValue = document.getElementById("tempValue");
const debounceValue = document.getElementById("debounceValue");
const saveButton = document.getElementById("saveButton");

// Validate OpenAI API key
async function validateApiKey(apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Invalid API key');
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

// Show status message
function showStatus(message, isError = false) {
  apiStatus.textContent = message;
  apiStatus.className = `status ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    apiStatus.className = 'status';
  }, 3000);
}

// Format debounce time display
function formatDebounceTime(value) {
  return `${Number(value).toFixed(1)}s`;
}

// Save settings to Chrome storage
async function saveSettings(e) {
  e.preventDefault();
  saveButton.disabled = true;
  
  const apiKey = settingsForm.apiKey.value.trim();
  const modelTemp = settingsForm.modelTemp.value;
  const debounceTime = settingsForm.debounceTime.value;
  const waitForPause = settingsForm.waitForPause.checked;
  const useGhostText = settingsForm.useGhostText.checked;
  
  // Validate API key format
  if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
    showStatus('Invalid API key format', true);
    saveButton.disabled = false;
    return;
  }
  
  // Show loading state
  saveButton.textContent = 'Validating...';
  
  // Validate API key with OpenAI
  const isValid = await validateApiKey(apiKey);
  
  if (!isValid) {
    showStatus('Invalid API key', true);
    saveButton.textContent = 'Save Settings';
    saveButton.disabled = false;
    return;
  }
  
  // Save settings
  settings.apiKey = apiKey;
  settings.modelTemp = modelTemp;
  settings.debounceTime = debounceTime;
  settings.waitForPause = waitForPause;
  settings.useGhostText = useGhostText;
  
  await chrome.storage.sync.set(settings);
  showStatus('Settings saved successfully');
  
  saveButton.textContent = 'Save Settings';
  saveButton.disabled = false;
}

// Initialize the settings in the popup
async function loadSettings() {
  const settings = await chrome.storage.sync.get();
  
  // Set API key if it exists (value is hidden by password input)
  if (settings.apiKey) {
    document.getElementById('apiKey').value = settings.apiKey;
  }
  
  // Set and display temperature value
  const temp = settings.modelTemp || '1.0';
  const tempInput = document.getElementById('modelTemp');
  tempInput.value = temp;
  tempValue.textContent = temp;
  
  // Set and display debounce time
  const debounceTime = settings.debounceTime || '0';
  const debounceInput = document.getElementById('debounceTime');
  debounceInput.value = debounceTime;
  debounceValue.textContent = formatDebounceTime(debounceTime);
  
  // Set wait for pause checkbox
  const waitForPause = settings.waitForPause || false;
  document.getElementById('waitForPause').checked = waitForPause;
  
  // Set ghost text checkbox
  const useGhostText = settings.useGhostText || false;
  document.getElementById('useGhostText').checked = useGhostText;
  
  return settings;
}

// Update temperature display when slider moves
document.getElementById('modelTemp').addEventListener('input', (e) => {
  tempValue.textContent = e.target.value;
});

// Update debounce time display when slider moves
document.getElementById('debounceTime').addEventListener('input', (e) => {
  debounceValue.textContent = formatDebounceTime(e.target.value);
});

// Call loadSettings when the popup is loaded
document.addEventListener('DOMContentLoaded', loadSettings);

// Add form submit handler
settingsForm.addEventListener('submit', saveSettings);
