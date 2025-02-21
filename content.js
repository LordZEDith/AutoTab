const debug = true;

// Track active element and its mutation observer
let activeElement = null;
let activeObserver = null;
let lastTypingTime = Date.now();
let debounceTimer = null;
let settings = { debounceTime: 0, waitForPause: false, useGhostText: false };
let lastCompletionTime = 0; // Track when the last completion was accepted
let hasTypedSinceCompletion = true; // Track if user has typed since last completion
let currentGhostText = null; // Track current ghost text element
let currentSuggestion = null; // Track current suggestion text
let currentLastWord = null; // Track current lastWord

/* Helper functions */
function createTooltip(message, isLoading = false, isError = false, alternatives = []) {
  const tooltip = document.createElement('div');
  tooltip.className = `ai-autotab-tooltip ${isLoading ? 'loading' : ''} ${isError ? 'ai-autotab-error' : ''}`;
  
  if (isLoading) {
    const spinner = document.createElement('div');
    spinner.className = 'ai-autotab-spinner';
    tooltip.appendChild(spinner);
    tooltip.appendChild(document.createTextNode('AI is thinking...'));
    return tooltip;
  }

  if (isError) {
    tooltip.appendChild(document.createTextNode(message));
    return tooltip;
  }

  // Get the current word being typed
  const element = activeElement;
  const content = getEditorContent(element);
  const cursorPos = getCursorPosition(element);
  const textBeforeCursor = content.slice(0, cursorPos);
  const currentWordMatch = textBeforeCursor.match(/\S+$/);
  const currentWord = currentWordMatch ? currentWordMatch[0] : '';
  const fullTextBeforeCursor = textBeforeCursor.trim();
  
  // Split the message into words
  const messageWords = message.split(' ');
  const typedWords = fullTextBeforeCursor.split(' ');

  // Create a container for the completion text
  const completionText = document.createElement('div');
  completionText.className = 'ai-autotab-completion';
  
  // Show only the remaining part of the completion
  let remainingText = '';
  if (currentWord) {
    // Find which word we're completing
    const matchingWordIndex = messageWords.findIndex(word => 
      word.toLowerCase().startsWith(currentWord.toLowerCase())
    );
    
    if (matchingWordIndex !== -1) {
      // Show the rest of the current word and any following words
      remainingText = messageWords[matchingWordIndex].slice(currentWord.length);
      if (matchingWordIndex < messageWords.length - 1) {
        remainingText += ' ' + messageWords.slice(matchingWordIndex + 1).join(' ');
      }
    }
  } else if (textBeforeCursor.endsWith(' ')) {
    // Check if the last typed word matches a word in the message
    const lastTypedWord = typedWords[typedWords.length - 1];
    const matchingWordIndex = messageWords.findIndex(word => 
      word.toLowerCase() === lastTypedWord?.toLowerCase()
    );
    
    if (matchingWordIndex !== -1 && matchingWordIndex < messageWords.length - 1) {
      // Show the remaining words after the match
      remainingText = messageWords.slice(matchingWordIndex + 1).join(' ');
    }
  } else {
    remainingText = message;
  }

  if (!remainingText.trim()) {
    return null; // Don't show tooltip if no remaining text
  }

  completionText.textContent = remainingText.trim();
  tooltip.appendChild(completionText);

  // Add alternatives if available
  if (alternatives && alternatives.length > 0) {
    const altContainer = document.createElement('div');
    altContainer.className = 'ai-autotab-alternatives';
    alternatives.forEach((alt, index) => {
      const altText = document.createElement('div');
      altText.className = 'ai-autotab-alt-item';
      
      // Handle alternatives the same way as the main completion
      let altRemaining = '';
      if (currentWord) {
        const altWords = alt.split(' ');
        const matchingAltIndex = altWords.findIndex(word => 
          word.toLowerCase().startsWith(currentWord.toLowerCase())
        );
        
        if (matchingAltIndex !== -1) {
          altRemaining = altWords[matchingAltIndex].slice(currentWord.length);
          if (matchingAltIndex < altWords.length - 1) {
            altRemaining += ' ' + altWords.slice(matchingAltIndex + 1).join(' ');
          }
        }
      } else if (textBeforeCursor.endsWith(' ')) {
        const altWords = alt.split(' ');
        const lastTypedWord = typedWords[typedWords.length - 1];
        const matchingAltIndex = altWords.findIndex(word => 
          word.toLowerCase() === lastTypedWord?.toLowerCase()
        );
        
        if (matchingAltIndex !== -1 && matchingAltIndex < altWords.length - 1) {
          altRemaining = altWords.slice(matchingAltIndex + 1).join(' ');
        }
      } else {
        altRemaining = alt;
      }

      if (altRemaining.trim()) {
        altText.textContent = `${index + 1}: ${altRemaining.trim()}`;
        altContainer.appendChild(altText);
      }
    });
    if (altContainer.children.length > 0) {
      tooltip.appendChild(altContainer);
    }
  }

  // Add usage hint
  const hint = document.createElement('div');
  hint.className = 'ai-autotab-hint';
  hint.textContent = alternatives.length > 0 
    ? 'Press Tab to accept or 1-3 for alternatives. Esc to dismiss' 
    : 'Press Tab to accept or Esc to dismiss';
  tooltip.appendChild(hint);

  return tooltip;
}

function positionTooltip(tooltip, target) {
  const rect = target.getBoundingClientRect();
  const tooltipTop = rect.bottom + window.scrollY;
  const tooltipLeft = rect.left + window.scrollX;

  tooltip.style.position = 'absolute';
  tooltip.style.zIndex = '999999';
  tooltip.style.left = `${tooltipLeft}px`;
  tooltip.style.top = `${tooltipTop}px`;
  
  document.body.appendChild(tooltip);

  // Ensure tooltip is visible within viewport
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Handle horizontal positioning
  if (tooltipRect.right > viewportWidth) {
    tooltip.style.left = `${viewportWidth - tooltipRect.width - 10}px`;
  }

  // Handle vertical positioning
  if (tooltipRect.bottom > viewportHeight) {
    // Position above the target
    tooltip.style.top = `${rect.top + window.scrollY - tooltipRect.height - 10}px`;
    tooltip.classList.add('position-above');
  } else {
    // Position below the target
    tooltip.classList.remove('position-above');
  }
}

// Check if element is a valid input field
function isValidInputField(element) {
  if (!element) return false;

  // Basic input types
  if (element instanceof HTMLInputElement) {
    const validTypes = ['text', 'search', 'url', 'email', 'tel'];
    return validTypes.includes(element.type.toLowerCase());
  }

  // Textarea
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  // Contenteditable elements (like Google Docs, rich text editors)
  if (element.isContentEditable) {
    return true;
  }

  // Monaco editor (VS Code-like editors)
  if (element.classList.contains('monaco-editor')) {
    return true;
  }

  // CodeMirror editor
  if (element.classList.contains('CodeMirror')) {
    return true;
  }

  // Check for common rich text editor frameworks
  const editorClasses = [
    'ql-editor', // Quill
    'ProseMirror', // ProseMirror
    'tox-edit-area', // TinyMCE
    'cke_editable', // CKEditor
    'ace_editor', // Ace Editor
    'froala-editor', // Froala
    'trumbowyg-editor', // Trumbowyg
    'medium-editor' // Medium Editor
  ];

  return editorClasses.some(className => element.classList.contains(className));
}

// Get text content from different types of editors
function getEditorContent(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }

  if (element.isContentEditable) {
    return element.textContent;
  }

  // Handle different editor frameworks
  if (element.classList.contains('monaco-editor')) {
    // Monaco editor handling
    const model = element.querySelector('.monaco-editor')?.['_modelData']?.['model'];
    return model ? model.getValue() : '';
  }

  if (element.classList.contains('CodeMirror')) {
    // CodeMirror handling
    return element.CodeMirror?.getValue() || '';
  }

  // Default to textContent
  return element.textContent || '';
}

// Get cursor position from different types of editors
function getCursorPosition(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.selectionStart;
  }

  if (element.isContentEditable) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      return range.startOffset;
    }
  }

  // Handle different editor frameworks
  if (element.classList.contains('monaco-editor')) {
    const model = element.querySelector('.monaco-editor')?.['_modelData']?.['model'];
    const position = model?.getPosition();
    return position ? model.getOffsetAt(position) : 0;
  }

  if (element.classList.contains('CodeMirror')) {
    const cm = element.CodeMirror;
    if (cm) {
      const pos = cm.getCursor();
      return cm.indexFromPos(pos);
    }
  }

  return 0;
}

// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get(['debounceTime', 'waitForPause', 'useGhostText']);
  settings.debounceTime = parseFloat(stored.debounceTime || 0) * 1000; // Convert to milliseconds
  settings.waitForPause = stored.waitForPause || false;
  settings.useGhostText = stored.useGhostText || false;
}

// Initialize settings
loadSettings();

// Listen for settings changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.debounceTime) {
    settings.debounceTime = parseFloat(changes.debounceTime.newValue || 0) * 1000;
  }
  if (changes.waitForPause) {
    settings.waitForPause = changes.waitForPause.newValue || false;
  }
  if (changes.useGhostText) {
    settings.useGhostText = changes.useGhostText.newValue || false;
  }
});

// Format debounce time display with 2 decimal places
function formatDebounceTime(value) {
  return `${Number(value).toFixed(2)}s`;
}

// Handle input events
function handleInput(event) {
  const element = event.target;
  
  if (!isValidInputField(element)) return;

  const content = getEditorContent(element);
  const cursorPos = getCursorPosition(element);
  const textBeforeCursor = content.slice(0, cursorPos);

  // Check if we're currently typing the suggestion
  if (currentSuggestion && currentLastWord) {
    const currentWordMatch = textBeforeCursor.match(/\S+$/);
    const currentWord = currentWordMatch ? currentWordMatch[0] : '';
    const fullTextBeforeCursor = textBeforeCursor.trim();
    
    // Split the suggestion into words
    const suggestionWords = currentSuggestion.split(' ');
    const typedWords = fullTextBeforeCursor.split(' ');
    
    // Check if we're typing any part of the suggestion
    const isTypingSuggestion = suggestionWords.some((word, index) => {
      // If we just pressed space, check if the last typed word matches the previous suggestion word
      if (!currentWord && textBeforeCursor.endsWith(' ')) {
        const lastTypedWord = typedWords[typedWords.length - 1];
        return lastTypedWord && suggestionWords[index - 1] && 
               lastTypedWord.toLowerCase() === suggestionWords[index - 1].toLowerCase();
      }
      
      // Otherwise check if current word matches any part of the suggestion
      return currentWord && word.toLowerCase().startsWith(currentWord.toLowerCase());
    });

    if (debug) {
      console.log('AutoTab: Checking if typing suggestion:', {
        currentWord,
        fullTextBeforeCursor,
        currentSuggestion,
        currentLastWord,
        isTypingSuggestion,
        suggestionWords,
        typedWords
      });
    }

    if (isTypingSuggestion) {
      // Update ghost text and tooltip to show only remaining text
      if (settings.useGhostText) {
        removeGhostText();
        createGhostText(currentSuggestion, currentLastWord);
      } else {
        // Update tooltip
        document.querySelectorAll('.ai-autotab-tooltip').forEach(t => t.remove());
        const tooltip = createTooltip(currentSuggestion, false, false, []);
        if (tooltip) {
          positionTooltip(tooltip, element);

          // Re-add the keydown handler for the new tooltip
          function keydownHandler(e) {
            if (e.key === 'Tab') {
              e.preventDefault();
              handleCompletion(currentSuggestion, currentLastWord);
              tooltip.remove();
              resetSuggestionState();
            } else if (e.key === 'Escape' || e.key === 'Enter') {
              tooltip.remove();
              resetSuggestionState();
            }
          }

          document.addEventListener('keydown', keydownHandler);

          const tooltipObserver = new MutationObserver((mutations) => {
            if (!document.body.contains(tooltip)) {
              document.removeEventListener('keydown', keydownHandler);
              tooltipObserver.disconnect();
            }
          });

          tooltipObserver.observe(document.body, {
            childList: true,
            subtree: true
          });
        }
      }
      return;
    }
  }

  // Only set hasTypedSinceCompletion to true if this is a real user input event
  // This prevents the flag from being set when we programmatically update the content
  if (event.inputType && event.inputType.startsWith('insert') || event.inputType === 'deleteContentBackward') {
    hasTypedSinceCompletion = true;
  }

  // At this point, we know we're not typing the suggestion, so remove UI elements
  document.querySelectorAll('.ai-autotab-tooltip').forEach(t => t.remove());
  removeGhostText();

  // Clear current suggestion since we're not typing it
  currentSuggestion = null;
  currentLastWord = null;

  // Update last typing time
  lastTypingTime = Date.now();

  // Clear existing timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Log input detection if in debug mode
  if (debug) {
    console.log('AutoTab Input Detected:', {
      content: content,
      cursorPosition: cursorPos,
      elementType: element.tagName,
      elementClass: element.className,
      timeSinceLastCompletion: Date.now() - lastCompletionTime,
      hasTypedSinceCompletion: hasTypedSinceCompletion
    });
  }

  // Only proceed if there's actual content and user has typed since last completion
  if (!content.trim() || !hasTypedSinceCompletion) {
    if (debug) {
      console.log('AutoTab: Skipping suggestion:', {
        emptyContent: !content.trim(),
        hasTypedSinceCompletion: hasTypedSinceCompletion
      });
    }
    return;
  }

  // Check if we should wait for typing pause
  const shouldWaitForPause = settings.waitForPause;
  const debounceTime = settings.debounceTime;

  debounceTimer = setTimeout(() => {
    // If waiting for pause is enabled, check if user has stopped typing
    if (shouldWaitForPause) {
      const timeSinceLastType = Date.now() - lastTypingTime;
      if (timeSinceLastType < debounceTime) {
        return;
      }
    }

    // Show loading tooltip
    const loadingTooltip = createTooltip('', true);
    positionTooltip(loadingTooltip, element);

    // Get context from the page
    const context = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      nearbyText: getNearbyText(element),
      inputContext: {
        placeholder: element instanceof HTMLInputElement ? element.placeholder : '',
        label: getInputLabel(element),
        name: element instanceof HTMLInputElement ? element.name : '',
        type: element instanceof HTMLInputElement ? element.type : 'text'
      }
    };

    // Send message to background script
    chrome.runtime.sendMessage({
      type: 'TEXT_BOX_UPDATED',
      textBoxContent: content,
      cursorPosition: cursorPos,
      context: context,
      hasTypedSinceCompletion: hasTypedSinceCompletion
    });
  }, debounceTime);
}

// Set up mutation observer for dynamic content
function observeElement(element) {
  if (activeObserver) {
    activeObserver.disconnect();
  }

  activeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' || mutation.type === 'childList') {
        handleInput({ target: element });
      }
    }
  });

  activeObserver.observe(element, {
    characterData: true,
    childList: true,
    subtree: true
  });
}

// Listen for focus events
document.addEventListener('focus', (event) => {
  const element = event.target;
  
  if (!isValidInputField(element)) return;
  
  activeElement = element;
  observeElement(element);
  
  if (debug) {
    console.log('AutoTab: Input field focused', {
      type: element.tagName,
      class: element.className
    });
  }
}, true);

// Listen for blur events
document.addEventListener('blur', (event) => {
  if (activeObserver) {
    activeObserver.disconnect();
  }
  activeElement = null;
}, true);

// Listen for input events
document.addEventListener('input', handleInput, true);

// Listen for Enter key and button clicks globally
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    resetSuggestionState();
  }
}, true);

document.addEventListener('click', (event) => {
  // Check if clicked element is a button or link
  if (event.target.tagName === 'BUTTON' || 
      event.target.tagName === 'A' || 
      event.target.closest('button') || 
      event.target.closest('a') ||
      event.target.getAttribute('role') === 'button' ||
      event.target.type === 'submit') {
    resetSuggestionState();
  }
}, true);

// Listen for form submissions
document.addEventListener('submit', (event) => {
  resetSuggestionState();
}, true);

// Handle completion acceptance
function handleCompletion(completionText, lastWord = '') {
  const element = activeElement;
  if (!element) return;

  // Update completion tracking
  lastCompletionTime = Date.now();
  hasTypedSinceCompletion = false;
  
  // Clear any existing timer and remove tooltips
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  if (debug) {
    console.log('AutoTab: Completion accepted:', {
      completionText,
      lastWord,
      timestamp: lastCompletionTime,
      hasTypedSinceCompletion: false
    });
  }

  const content = getEditorContent(element);
  const cursorPos = getCursorPosition(element);

  // Get the current word being typed
  const textBeforeCursor = content.slice(0, cursorPos);
  const currentWordMatch = textBeforeCursor.match(/\S+$/);
  const currentWord = currentWordMatch ? currentWordMatch[0] : '';

  let beforeCursor = content.slice(0, cursorPos);
  const afterCursor = content.slice(cursorPos);

  // Check if we're completing the current word by seeing if it's a partial match of lastWord
  const isCompletingWord = lastWord && currentWord && 
    lastWord.toLowerCase().startsWith(currentWord.toLowerCase()) &&
    (completionText.toLowerCase().startsWith(currentWord.toLowerCase()) || 
     lastWord.toLowerCase().slice(currentWord.length).startsWith(completionText.toLowerCase().split(' ')[0]));

  if (debug) {
    console.log('AutoTab: Word Analysis:', {
      currentWord,
      lastWord,
      completionText,
      isCompletingWord,
      beforeCursor,
      afterCursor,
      firstCompletionWord: completionText.toLowerCase().split(' ')[0]
    });
  }

  if (currentWord && isCompletingWord) {
    // Remove the partial word from before cursor since we're completing it
    beforeCursor = beforeCursor.slice(0, -currentWord.length);
    
    // If we're completing a word, use the lastWord for the first part
    const completionWords = completionText.split(' ');
    const finalCompletion = lastWord + (completionWords.length > 1 ? ' ' + completionWords.slice(1).join(' ') : '');
    
    const needsSpaceAfter = afterCursor.length > 0 && !afterCursor.startsWith(' ');
    const finalText = finalCompletion + (needsSpaceAfter ? ' ' : '');

    if (debug) {
      console.log('AutoTab: Word completion:', {
        beforeCursor,
        finalCompletion,
        afterCursor,
        currentWord,
        completionText,
        lastWord,
        isCompletingWord,
        finalText
      });
    }

    updateEditorContent(element, beforeCursor + finalText + afterCursor, 
                      beforeCursor.length + finalText.length);
  } else {
    // For new words, handle spacing exactly like ghost text
    const needsSpaceBefore = !beforeCursor.endsWith(' ');
    const needsSpaceAfter = afterCursor.length > 0 && !afterCursor.startsWith(' ');
    
    const finalCompletion = 
      (needsSpaceBefore ? ' ' : '') + 
      completionText + 
      (needsSpaceAfter ? ' ' : '');

    if (debug) {
      console.log('AutoTab: New word completion:', {
        beforeCursor,
        finalCompletion,
        afterCursor,
        currentWord,
        completionText,
        lastWord,
        isCompletingWord
      });
    }

    updateEditorContent(element, beforeCursor + finalCompletion + afterCursor,
                      beforeCursor.length + finalCompletion.length);
  }
}

// Update content in different types of editors
function updateEditorContent(element, newContent, cursorPosition) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = newContent;
    element.selectionStart = cursorPosition;
    element.selectionEnd = cursorPosition;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (element.isContentEditable) {
    element.textContent = newContent;
    const selection = window.getSelection();
    const range = document.createRange();
    
    // Find the text node and position
    let currentNode = element.firstChild;
    let currentPos = 0;
    while (currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const length = currentNode.length;
        if (currentPos + length >= cursorPosition) {
          range.setStart(currentNode, cursorPosition - currentPos);
          range.setEnd(currentNode, cursorPosition - currentPos);
          break;
        }
        currentPos += length;
      }
      currentNode = currentNode.nextSibling;
    }
    
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (element.classList.contains('monaco-editor')) {
    const model = element.querySelector('.monaco-editor')?.['_modelData']?.['model'];
    if (model) {
      const position = model.getPositionAt(cursorPosition);
      model.setValue(newContent);
      model.setPosition(position);
    }
  } else if (element.classList.contains('CodeMirror')) {
    const cm = element.CodeMirror;
    if (cm) {
      cm.setValue(newContent);
      const pos = cm.posFromIndex(cursorPosition);
      cm.setCursor(pos);
    }
  }
}

// Function to remove tooltips and reset typing state
function resetSuggestionState() {
  // Check if we're typing the suggestion before removing UI elements
  if (activeElement) {
    const content = getEditorContent(activeElement);
    const cursorPos = getCursorPosition(activeElement);
    const textBeforeCursor = content.slice(0, cursorPos);
    const currentWordMatch = textBeforeCursor.match(/\S+$/);
    const currentWord = currentWordMatch ? currentWordMatch[0] : '';
    
    const isTypingSuggestion = currentLastWord && currentWord &&
      (currentLastWord.toLowerCase().startsWith(currentWord.toLowerCase()) ||
       currentSuggestion?.toLowerCase().startsWith(currentWord.toLowerCase()));
       
    if (isTypingSuggestion) {
      return; // Don't reset state if typing suggestion
    }
  }

  document.querySelectorAll('.ai-autotab-tooltip').forEach(t => t.remove());
  removeGhostText();
  hasTypedSinceCompletion = false;
  currentSuggestion = null;
  currentLastWord = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  if (debug) {
    console.log('AutoTab: Reset suggestion state due to user action');
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'LOG_MESSAGE') {
    const prefix = 'AutoTab:';
    switch (request.level) {
      case 'error':
        console.error(prefix, request.message, request.data);
        break;
      case 'warn':
        console.warn(prefix, request.message, request.data);
        break;
      case 'info':
      default:
        console.log(prefix, request.message, request.data);
        break;
    }
    return;
  }

  if (request.type !== 'COMPLETION_RECEIVED' || !activeElement) {
    return;
  }

  // Remove any existing tooltips and ghost text
  document.querySelectorAll('.ai-autotab-tooltip').forEach(t => t.remove());
  removeGhostText();

  if (request.error) {
    console.error('AutoTab: Error received:', request.error);
    const errorTooltip = createTooltip(request.error, false, true);
    positionTooltip(errorTooltip, activeElement);
    setTimeout(() => errorTooltip.remove(), 3000);
    return;
  }

  if (!request.completion) {
    console.log('AutoTab: No completion received');
    return;
  }

  // Check if ghost text mode is enabled
  if (settings.useGhostText) {
    const ghostText = createGhostText(request.completion, request.lastWord);
    
    // Handle keyboard events for ghost text
    function keydownHandler(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
        handleCompletion(request.completion, request.lastWord);
        removeGhostText();
      } else if (e.key === 'Escape') {
        removeGhostText();
      } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        // Only remove if we're not typing the suggestion
        const content = getEditorContent(activeElement);
        const cursorPos = getCursorPosition(activeElement);
        const textBeforeCursor = content.slice(0, cursorPos);
        const currentWordMatch = textBeforeCursor.match(/\S+$/);
        const currentWord = currentWordMatch ? currentWordMatch[0] : '';
        
        const isTypingSuggestion = currentLastWord && currentWord &&
          (currentLastWord.toLowerCase().startsWith(currentWord.toLowerCase()) ||
           currentSuggestion.toLowerCase().startsWith(currentWord.toLowerCase()));
           
        if (!isTypingSuggestion) {
          removeGhostText();
        }
      }
    }

    // Add keyboard event listener
    document.addEventListener('keydown', keydownHandler);

    // Remove event listener when ghost text is removed
    const observer = new MutationObserver((mutations) => {
      if (!document.body.contains(ghostText)) {
        document.removeEventListener('keydown', keydownHandler);
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  } else {
    // Original tooltip behavior
    const tooltip = createTooltip(request.completion, false, false, request.alternatives);
    positionTooltip(tooltip, activeElement);

    // Handle keyboard events for tooltip
    function keydownHandler(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        handleCompletion(request.completion, request.lastWord);
        tooltip.remove();
        resetSuggestionState();
      } else if (e.key >= '1' && e.key <= '9' && request.alternatives && request.alternatives[e.key - 1]) {
        e.preventDefault();
        handleCompletion(request.alternatives[e.key - 1], request.lastWord);
        tooltip.remove();
        resetSuggestionState();
      } else if (e.key === 'Escape' || e.key === 'Enter') {
        tooltip.remove();
        resetSuggestionState();
      } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        // Only remove if we're not typing the suggestion
        const content = getEditorContent(activeElement);
        const cursorPos = getCursorPosition(activeElement);
        const textBeforeCursor = content.slice(0, cursorPos);
        const currentWordMatch = textBeforeCursor.match(/\S+$/);
        const currentWord = currentWordMatch ? currentWordMatch[0] : '';
        
        const isTypingSuggestion = currentLastWord && currentWord &&
          (currentLastWord.toLowerCase().startsWith(currentWord.toLowerCase()) ||
           currentSuggestion.toLowerCase().startsWith(currentWord.toLowerCase()));
           
        if (!isTypingSuggestion) {
      tooltip.remove();
        }
      }
    }

    // Add keyboard event listener
    document.addEventListener('keydown', keydownHandler);

    // Remove event listener when tooltip is removed
    const tooltipObserver = new MutationObserver((mutations) => {
      if (!document.body.contains(tooltip)) {
        document.removeEventListener('keydown', keydownHandler);
        tooltipObserver.disconnect();
      }
    });

    tooltipObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (request.type === 'COMPLETION_RECEIVED' && !request.error && request.completion) {
    currentSuggestion = request.completion;
    currentLastWord = request.lastWord;
  }
});

// Helper function to get nearby text content
function getNearbyText(element, maxDistance = 300) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // Get all text nodes within the viewport
  const textNodes = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  while (node = walker.nextNode()) {
    const nodeRect = node.parentElement.getBoundingClientRect();
    const nodeCenterX = nodeRect.left + nodeRect.width / 2;
    const nodeCenterY = nodeRect.top + nodeRect.height / 2;
    
    // Calculate distance
    const distance = Math.sqrt(
      Math.pow(centerX - nodeCenterX, 2) + 
      Math.pow(centerY - nodeCenterY, 2)
    );
    
    if (distance <= maxDistance) {
      const text = node.textContent.trim();
      if (text.length > 0) {
        textNodes.push({
          text: text,
          distance: distance
        });
      }
    }
  }
  
  // Sort by distance and return concatenated text
  return textNodes
    .sort((a, b) => a.distance - b.distance)
    .map(node => node.text)
    .join(' ');
}

// Helper function to get input label text
function getInputLabel(input) {
  // Check for aria-label
  if (input.getAttribute('aria-label')) {
    return input.getAttribute('aria-label');
  }
  
  // Check for associated label element
  const id = input.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) {
      return label.textContent;
    }
  }
  
  // Check for parent label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    return parentLabel.textContent;
  }
  
  // Check for preceding label or text
  const previousElement = input.previousElementSibling;
  if (previousElement && (previousElement.tagName === 'LABEL' || previousElement.tagName === 'SPAN')) {
    return previousElement.textContent;
  }
  
  return '';
}

function createGhostText(completion, lastWord) {
  // Remove any existing ghost text
  removeGhostText();

  const element = activeElement;
  if (!element) return;

  // Get the computed style of the input
  const computedStyle = window.getComputedStyle(element);
  
  // Create ghost text element
  const ghostText = document.createElement('div');
  ghostText.className = 'ai-ghost-text';
  
  // Get the current word being typed
  const content = getEditorContent(element);
  const cursorPos = getCursorPosition(element);
  const textBeforeCursor = content.slice(0, cursorPos);
  const currentWordMatch = textBeforeCursor.match(/\S+$/);
  const currentWord = currentWordMatch ? currentWordMatch[0] : '';
  const afterCursor = content.slice(cursorPos);

  // Split the completion into words
  const completionWords = completion.split(' ');
  const typedWords = textBeforeCursor.trim().split(' ');
  
  // Check if we're completing the current word or continuing a multi-word suggestion
  const isCompletingWord = currentWord && completionWords.some(word => 
    word.toLowerCase().startsWith(currentWord.toLowerCase())
  );

  const isSpaceAfterWord = !currentWord && textBeforeCursor.endsWith(' ');

  if (debug) {
    console.log('Ghost Text Word Analysis:', {
      currentWord,
      lastWord,
      completion,
      completionWords,
      typedWords,
      isCompletingWord,
      isSpaceAfterWord,
      textBeforeCursor,
      afterCursor
    });
  }

  // Format the ghost text content based on context
  let ghostTextContent = '';
  
  if (isCompletingWord) {
    // Find which word we're completing
    const matchingWordIndex = completionWords.findIndex(word => 
      word.toLowerCase().startsWith(currentWord.toLowerCase())
    );
    
    if (matchingWordIndex !== -1) {
      // Show the rest of the current word and any following words
      ghostTextContent = completionWords[matchingWordIndex].slice(currentWord.length);
      if (matchingWordIndex < completionWords.length - 1) {
        ghostTextContent += ' ' + completionWords.slice(matchingWordIndex + 1).join(' ');
      }
    }
  } else if (isSpaceAfterWord) {
    // Check if the last typed word matches a word in the completion
    const lastTypedWord = typedWords[typedWords.length - 1];
    const matchingWordIndex = completionWords.findIndex(word => 
      word.toLowerCase() === lastTypedWord?.toLowerCase()
    );
    
    if (matchingWordIndex !== -1 && matchingWordIndex < completionWords.length - 1) {
      // Show the remaining words after the match
      ghostTextContent = completionWords.slice(matchingWordIndex + 1).join(' ');
    }
  } else {
    // For new words, handle spacing
    const needsSpaceBefore = !textBeforeCursor.endsWith(' ');
    const needsSpaceAfter = afterCursor.length > 0 && !afterCursor.startsWith(' ');
    
    ghostTextContent = 
      (needsSpaceBefore ? ' ' : '') + 
      completion +
      (needsSpaceAfter ? ' ' : '');
  }
  
  // Don't show empty ghost text
  if (!ghostTextContent.trim()) {
    return null;
  }
  
  ghostText.textContent = ghostTextContent;
  
  // Copy relevant styles from the input
  const stylesToCopy = [
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'padding',
    'text-indent',
    'letter-spacing',
    'text-transform',
    'word-spacing',
    'text-rendering'
  ];

  stylesToCopy.forEach(style => {
    ghostText.style[style] = computedStyle[style];
  });

  // Position the ghost text
  const rect = element.getBoundingClientRect();
  
  // Create a temporary span to measure text width
  const measureSpan = document.createElement('span');
  measureSpan.style.visibility = 'hidden';
  measureSpan.style.position = 'absolute';
  measureSpan.style.whiteSpace = 'pre';
  stylesToCopy.forEach(style => {
    measureSpan.style[style] = computedStyle[style];
  });
  measureSpan.textContent = textBeforeCursor;
  document.body.appendChild(measureSpan);
  
  // Calculate position
  const textWidth = measureSpan.getBoundingClientRect().width;
  measureSpan.remove();

  ghostText.style.top = `${rect.top + window.scrollY}px`;
  ghostText.style.left = `${rect.left + textWidth}px`;
  
  // Add to DOM
  document.body.appendChild(ghostText);
  currentGhostText = ghostText;

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    ghostText.classList.add('dark-mode');
  }

  return ghostText;
}

function removeGhostText() {
  if (currentGhostText) {
    currentGhostText.remove();
    currentGhostText = null;
  }
}
