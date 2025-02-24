const debug = false;

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
  const afterCursor = content.slice(cursorPos);
  const fullTextBeforeCursor = textBeforeCursor.trim();
  const cursorHasSpace = textBeforeCursor.endsWith(' ');

  // Determine the last complete word (similar to ghost text logic)
  let lastCompleteWord = '';
  if (cursorHasSpace) {
    // If cursor is after a space, get the last word before the space
    const words = textBeforeCursor.trim().split(/\s+/);
    lastCompleteWord = words[words.length - 1] || '';
  } else if (!currentWord) {
    // If no current word and no space, get the last complete word
    const words = textBeforeCursor.trim().split(/\s+/);
    lastCompleteWord = words[words.length - 1] || '';
  } else {
    // If there's a current word, check if it's complete
    const words = textBeforeCursor.slice(0, -currentWord.length).trim().split(/\s+/);
    lastCompleteWord = words[words.length - 1] || '';
  }

  // Create a container for the completion text
  const completionText = document.createElement('div');
  completionText.className = 'ai-autotab-completion';
  
  let remainingText = '';
  if (currentWord) {
    // If we have a current suggestion and we're typing it
    if (currentSuggestion && currentSuggestion.toLowerCase().includes(textBeforeCursor.toLowerCase().trim())) {
      // Find where in the suggestion we currently are
      const normalizedSuggestion = currentSuggestion.toLowerCase();
      const normalizedTyped = textBeforeCursor.toLowerCase().trim();
      const index = normalizedSuggestion.indexOf(normalizedTyped);
      if (index !== -1) {
        // Show only what's left after what we've typed
        remainingText = currentSuggestion.slice(index + normalizedTyped.length);
      }
    } else {
      // Split both the suggestion and typed text into words
      const messageWords = message.split(' ');
      const firstWord = messageWords[0];
      
      if (firstWord.toLowerCase().startsWith(currentWord.toLowerCase())) {
        // Show remaining part of the first word without space
        const remainingPart = firstWord.slice(currentWord.length);
        remainingText = remainingPart;
        
        // Add any following words with proper spacing
        if (messageWords.length > 1) {
          remainingText += ' ' + messageWords.slice(1).join(' ');
        }
      } else {
        // Add space if we're after a complete word and don't have a space
        const needsSpace = !cursorHasSpace && lastCompleteWord !== '';
        remainingText = (needsSpace ? ' ' : '') + message;
      }
    }
  } else {
    // No current word being typed
    // Add space if we're after a complete word and don't have a space
    const needsSpace = !cursorHasSpace && lastCompleteWord !== '';
    remainingText = (needsSpace ? ' ' : '') + message;
  }

  if (debug) {
    console.log('AutoTab: Tooltip text analysis:', {
      currentWord,
      message,
      remainingText,
      textBeforeCursor,
      cursorHasSpace,
      lastCompleteWord,
      currentLastWord: lastCompleteWord,
      afterCursor,
      currentSuggestion
    });
  }

  if (!remainingText.trim()) {
    return null;
  }

  // Don't trim the leading space if we need it
  completionText.textContent = remainingText;
  tooltip.appendChild(completionText);

  // Add alternatives if available
  if (alternatives && alternatives.length > 0) {
    const altContainer = document.createElement('div');
    altContainer.className = 'ai-autotab-alternatives';
    
    alternatives.forEach((alt, index) => {
      const altText = document.createElement('div');
      altText.className = 'ai-autotab-alt-item';
      
      let altRemaining = '';
      if (currentWord) {
        const altWords = alt.split(' ');
        const firstWord = altWords[0];
        
        if (firstWord.toLowerCase().startsWith(currentWord.toLowerCase())) {
          // Show remaining part of the first word without space
          const remainingPart = firstWord.slice(currentWord.length);
          altRemaining = remainingPart;
          
          // Add any following words with proper spacing
          if (altWords.length > 1) {
            altRemaining += ' ' + altWords.slice(1).join(' ');
          }
        } else {
          // Add space if needed
          const needsSpace = !cursorHasSpace && lastCompleteWord !== '';
          altRemaining = (needsSpace ? ' ' : '') + alt;
        }
      } else {
        // Add space if needed
        const needsSpace = !cursorHasSpace && lastCompleteWord !== '';
        altRemaining = (needsSpace ? ' ' : '') + alt;
      }

      if (altRemaining.trim()) {
        altText.textContent = `${index + 1}: ${altRemaining}`;
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

  // Update currentLastWord for future reference
  currentLastWord = lastCompleteWord;

  // Set tooltip styles for positioning
  tooltip.style.position = 'absolute';
  tooltip.style.zIndex = '999999';
  tooltip.style.whiteSpace = 'pre';

  // Support dark mode
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    tooltip.classList.add('dark-mode');
  }

  return tooltip;
}

function positionTooltip(tooltip, target) {
  if (!tooltip || !target) {
    console.log('AutoTab: Cannot position tooltip - tooltip or target is null');
    return;
  }

  const rect = target.getBoundingClientRect();
  const tooltipTop = rect.bottom + window.scrollY;
  
  // Use the text width calculation from the tooltip creation
  const textWidth = tooltip.querySelector('.ai-autotab-completion')?.getBoundingClientRect().width || 0;
  const tooltipLeft = rect.left + textWidth;

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

// Handle input events
function handleInput(event) {
  const element = event.target;
  
  if (!isValidInputField(element)) return;

  const content = getEditorContent(element);
  const cursorPos = getCursorPosition(element);
  const textBeforeCursor = content.slice(0, cursorPos);
  const currentWordMatch = textBeforeCursor.match(/\S+$/);
  const currentWord = currentWordMatch ? currentWordMatch[0] : '';
  const fullTextBeforeCursor = textBeforeCursor.trim();
  let isMatchingWord = false;  // Moved to higher scope

  // Early check for space with ghost text to prevent any further processing
  if ((event.inputType === undefined || (event.inputType === 'insertText' && event.data === ' ')) && currentGhostText) {
    if (debug) {
      console.log('AutoTab: Early skip - Space with ghost text:', {
        eventType: event.inputType,
        eventData: event.data,
        hasGhostText: !!currentGhostText
      });
    }
    return;
  }

  // Check if we're currently typing the suggestion
  if (currentSuggestion && currentLastWord) {
    // Split both the suggestion and typed text into words
    const suggestionWords = currentSuggestion.split(' ');
    const typedWords = fullTextBeforeCursor.split(' ');
    
    // Track where we are in the suggestion
    let currentWordIndex = -1;
    let remainingText = '';
    let completeWord = '';

    // If we just typed a space, check if we were at the end of a word that matches the suggestion
    if (!currentWord && textBeforeCursor.endsWith(' ')) {
      const lastTypedWord = typedWords[typedWords.length - 1];
      // Find this word in the suggestion
      currentWordIndex = suggestionWords.findIndex(word => 
        word.toLowerCase() === lastTypedWord?.toLowerCase()
      );
      isMatchingWord = currentWordIndex !== -1;

      // If we found a match and there are more words in the suggestion, keep showing it
      if (isMatchingWord && currentWordIndex < suggestionWords.length - 1) {
        remainingText = suggestionWords.slice(currentWordIndex + 1).join(' ');
        completeWord = suggestionWords[currentWordIndex + 1];
        
        // Don't trigger AI call if we're still matching the suggestion
        if (event.inputType === undefined || (event.inputType === 'insertText' && event.data === ' ')) {
          if (debug) {
            console.log('AutoTab: Skipping AI call:', {
              reason: 'Space after matching word in suggestion',
              eventType: event.inputType,
              eventData: event.data,
              lastTypedWord,
              currentWordIndex,
              remainingText
            });
          }
          return;
        }
      }
    } else if (currentWord) {
      // Find if we're typing any word in the suggestion
      currentWordIndex = suggestionWords.findIndex(word => 
        word.toLowerCase().startsWith(currentWord.toLowerCase())
      );
      isMatchingWord = currentWordIndex !== -1;

      if (isMatchingWord) {
        // For partial word matches, find the complete word we're matching
        const matchedWord = suggestionWords[currentWordIndex];
        completeWord = matchedWord; // Store the complete word we're matching
        
        // Calculate remaining text based on complete word
        const remainingPart = matchedWord.slice(currentWord.length);
        remainingText = remainingPart;
        
        // Only add following words if we have them
        if (currentWordIndex < suggestionWords.length - 1) {
          // Add space only before additional words, not the remaining part of current word
          remainingText += ' ' + suggestionWords.slice(currentWordIndex + 1).join(' ');
        }
      }
    }

    if (debug) {
      console.log('AutoTab: Suggestion Analysis:', {
        currentWord,
        fullTextBeforeCursor,
        currentSuggestion,
        currentLastWord,
        currentWordIndex,
        isMatchingWord,
        suggestionWords,
        typedWords,
        remainingText,
        completeWord,
        eventType: event.inputType,
        eventData: event.data
      });
    }

    // Update UI if we're typing the suggestion
    if (isMatchingWord) {
      if (settings.useGhostText) {
        removeGhostText();
        const ghostText = createGhostText(remainingText, currentLastWord, completeWord);
        
        // Add keyboard event listener for ghost text
        if (ghostText) {
          function ghostKeydownHandler(e) {
            if (e.key === 'Tab') {
              e.preventDefault();
              if (debug) {
                console.log('AutoTab: Removing ghost text:', {
                  reason: 'Tab key pressed',
                  currentWord: currentWord || currentLastWord,
                  remainingText,
                  completeWord
                });
              }
              handleCompletion(remainingText, currentWord || currentLastWord, completeWord);
              removeGhostText();
              resetSuggestionState();
            } else if (e.key === 'Escape' || e.key === 'Enter') {
              if (debug) {
                console.log('AutoTab: Removing ghost text:', {
                  reason: e.key + ' key pressed',
                  currentWord: currentWord || currentLastWord,
                  remainingText,
                  completeWord
                });
              }
              removeGhostText();
              resetSuggestionState();
            }
          }

          document.addEventListener('keydown', ghostKeydownHandler);

          // Remove event listener when ghost text is removed
          const ghostObserver = new MutationObserver((mutations) => {
            if (!document.body.contains(ghostText)) {
              document.removeEventListener('keydown', ghostKeydownHandler);
              ghostObserver.disconnect();
            }
          });

          ghostObserver.observe(document.body, {
            childList: true,
            subtree: true
          });
        }
      } else {
        // Update tooltip with remaining text
        document.querySelectorAll('.ai-autotab-tooltip').forEach(t => t.remove());
        // Calculate remaining text based on what we've typed
        const typedWords = fullTextBeforeCursor.split(' ');
        const suggestionWords = currentSuggestion.split(' ');
        let remainingText = '';

        if (currentWord) {
          // Find the word we're currently typing in the suggestion
          const matchingWordIndex = suggestionWords.findIndex(word => 
            word.toLowerCase().startsWith(currentWord.toLowerCase())
          );

          if (matchingWordIndex !== -1) {
            // Show remaining part of the current word
            remainingText = suggestionWords[matchingWordIndex].slice(currentWord.length);
            // Add any following words
            if (matchingWordIndex < suggestionWords.length - 1) {
              remainingText += ' ' + suggestionWords.slice(matchingWordIndex + 1).join(' ');
            }
          }
        } else {
          // Find the last typed word in the suggestion
          const lastTypedWord = typedWords[typedWords.length - 1];
          const matchingWordIndex = suggestionWords.findIndex(word => 
            word.toLowerCase() === lastTypedWord?.toLowerCase()
          );

          if (matchingWordIndex !== -1 && matchingWordIndex < suggestionWords.length - 1) {
            // Show remaining words after the matched word
            remainingText = suggestionWords.slice(matchingWordIndex + 1).join(' ');
          }
        }

        if (remainingText.trim()) {
          const tooltip = createTooltip(remainingText, false, false, []);
          if (tooltip) {
            positionTooltip(tooltip, element);
            addTooltipKeydownHandler(tooltip, currentSuggestion, currentLastWord);
          }
        }
      }
      return;
    }
  }

  // Only set hasTypedSinceCompletion to true if this is a real user input event
  // This prevents the flag from being set when we programmatically update the content
  if (event.inputType && event.inputType.startsWith('insert') || event.inputType === 'deleteContentBackward') {
    // Don't set hasTypedSinceCompletion if we're typing a space and there's ghost text
    if (!(event.inputType === 'insertText' && event.data === ' ' && currentGhostText)) {
      hasTypedSinceCompletion = true;
    }
  }

  // At this point, we know we're not typing the suggestion, so remove UI elements
  // But only if we're not typing a space with ghost text present
  if (!(event.inputType === 'insertText' && event.data === ' ' && currentGhostText) && 
      !(event.inputType === undefined && currentGhostText)) {
    document.querySelectorAll('.ai-autotab-tooltip').forEach(t => {
      console.log('AutoTab: Tooltip removed - Not typing suggestion anymore');
      t.remove();
    });
    if (debug) {
      console.log('AutoTab: Removing ghost text:', {
        reason: 'Not typing suggestion anymore',
        currentWord,
        currentSuggestion,
        currentLastWord,
        isMatchingWord,
        fullTextBeforeCursor,
        eventType: event.inputType,
        eventData: event.data,
        hasGhostText: !!currentGhostText
      });
    }
    removeGhostText();

    // Clear current suggestion since we're not typing it
    currentSuggestion = null;
    currentLastWord = null;
  }

  // Update last typing time
  lastTypingTime = Date.now();

  // Clear existing timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Skip AI call if we're typing a space and there's ghost text
  if ((event.inputType === undefined || (event.inputType === 'insertText' && event.data === ' ')) && currentGhostText) {
    if (debug) {
      console.log('AutoTab: Skipping AI call:', {
        reason: 'Space typed with ghost text present',
        ghostTextContent: currentGhostText.textContent,
        eventType: event.inputType,
        eventData: event.data
      });
    }
    return;
  }

  // Log input detection if in debug mode
  if (debug) {
    console.log('AutoTab Input Detected:', {
      content: content,
      cursorPosition: cursorPos,
      elementType: element.tagName,
      elementClass: element.className,
      timeSinceLastCompletion: Date.now() - lastCompletionTime,
      hasTypedSinceCompletion: hasTypedSinceCompletion,
      eventType: event.inputType,
      eventData: event.data,
      hasGhostText: !!currentGhostText
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
    if (loadingTooltip) {
      positionTooltip(loadingTooltip, element);
    }

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
function handleCompletion(completionText, lastWord = '', completeWord = '') {
  const element = activeElement;
  if (!element) return;

  // Update completion tracking
  lastCompletionTime = Date.now();
  hasTypedSinceCompletion = false;
  
  // Clear any existing timer and remove tooltips
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const content = getEditorContent(element);
  const cursorPos = getCursorPosition(element);
  const textBeforeCursor = content.slice(0, cursorPos);
  const currentWordMatch = textBeforeCursor.match(/\S+$/);
  const currentWord = currentWordMatch ? currentWordMatch[0] : '';
  const afterCursor = content.slice(cursorPos);
  const cursorHasSpace = textBeforeCursor.endsWith(' '); // Check if cursor is after a space

  // If we have ghost text, use its content directly
  if (currentGhostText) {
    const ghostTextContent = currentGhostText.textContent;
    // Keep the current word if it's part of what we're completing
    const finalText = textBeforeCursor + ghostTextContent;
    
    // Add any text that was after the cursor
    const needsSpaceAfter = afterCursor.length > 0 && !afterCursor.startsWith(' ');
    const completeText = finalText + (needsSpaceAfter ? ' ' : '') + afterCursor;
    
    // Set cursor position to end of inserted completion
    const newCursorPos = completeText.length - afterCursor.length;

    if (debug) {
      console.log('AutoTab: Ghost Text Completion:', {
        currentWord,
        ghostTextContent,
        finalText,
        completeText,
        newCursorPos
      });
    }

    updateEditorContent(element, completeText, newCursorPos);
    return;
  }

  // Split the completion into words
  const completionWords = completionText.split(' ');
  const firstCompletionWord = completionWords[0];
  
  let insertText = '';
  
  if (currentWord) {
    // Check if the first word of completion starts with current word
    if (firstCompletionWord.toLowerCase().startsWith(currentWord.toLowerCase())) {
      // Complete the current word and add remaining words
      insertText = completionText.slice(currentWord.length);
    } else {
      // Add space if cursor is at end of word and no space exists
      const needsSpace = !cursorHasSpace;
      insertText = (needsSpace ? ' ' : '') + completionText;
    }
  } else {
    // No current word, add space if needed
    const needsSpace = !cursorHasSpace;
    insertText = (needsSpace ? ' ' : '') + completionText;
  }

  // Construct the final text
  const finalText = textBeforeCursor + insertText;
  
  // Add any text that was after the cursor
  const needsSpaceAfter = afterCursor.length > 0 && !afterCursor.startsWith(' ');
  const completeText = finalText + (needsSpaceAfter ? ' ' : '') + afterCursor;
  
  // Set cursor position to end of inserted completion
  const newCursorPos = completeText.length - afterCursor.length;

  if (debug) {
    console.log('AutoTab: Completion Analysis:', {
      currentWord,
      completionText,
      completeWord,
      lastWord,
      insertText,
      finalText,
      completeText,
      newCursorPos,
      cursorHasSpace
    });
  }

  updateEditorContent(element, completeText, newCursorPos);

  // Update tooltip with remaining text if we're typing the suggestion
  if (currentSuggestion) {
    const remainingWords = completionWords.slice(1);
    if (remainingWords.length > 0) {
      const remainingText = remainingWords.join(' ');
      const tooltip = createTooltip(remainingText, false, false, []);
      if (tooltip) {
        positionTooltip(tooltip, element);
        addTooltipKeydownHandler(tooltip, remainingText, firstCompletionWord);
      }
    }
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
      if (debug) {
        console.log('AutoTab: Keeping ghost text:', {
          reason: 'Still typing suggestion',
          currentWord,
          currentSuggestion,
          currentLastWord
        });
      }
      return; // Don't reset state if typing suggestion
    }
  }

  document.querySelectorAll('.ai-autotab-tooltip').forEach(t => {
    console.log('AutoTab: Tooltip removed - Reset suggestion state');
    t.remove();
  });
  if (debug) {
    console.log('AutoTab: Removing ghost text:', {
      reason: 'Reset suggestion state',
      currentSuggestion,
      currentLastWord
    });
  }
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

  if (request.error) {
    console.error('AutoTab: Error received:', request.error);
    const errorTooltip = createTooltip(request.error, false, true);
    if (errorTooltip) {
      // Remove existing tooltips only after we know we have a new one to show
      document.querySelectorAll('.ai-autotab-tooltip').forEach(t => {
        console.log('AutoTab: Tooltip removed - New error tooltip');
        t.remove();
      });
      positionTooltip(errorTooltip, activeElement);
      setTimeout(() => {
        console.log('AutoTab: Tooltip removed - Error timeout');
        errorTooltip.remove();
      }, 3000);
    }
    return;
  }

  if (!request.completion) {
    console.log('AutoTab: No completion received');
    return;
  }

  // Check if ghost text mode is enabled
  if (settings.useGhostText) {
    removeGhostText(); // Clear any existing ghost text
    const ghostText = createGhostText(request.completion, request.lastWord, request.completion);
    if (ghostText) {
      // Store the current suggestion for future reference
      currentSuggestion = request.completion;
      currentLastWord = request.lastWord;
      
      // Remove any existing tooltips
      document.querySelectorAll('.ai-autotab-tooltip').forEach(t => {
        console.log('AutoTab: Tooltip removed - Switching to ghost text');
        t.remove();
      });

      // Add keyboard event listener for ghost text
      function ghostKeydownHandler(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          
          // Get the current state
          const content = getEditorContent(activeElement);
          const cursorPos = getCursorPosition(activeElement);
          const textBeforeCursor = content.slice(0, cursorPos);
          const currentWordMatch = textBeforeCursor.match(/\S+$/);
          const currentWord = currentWordMatch ? currentWordMatch[0] : '';
          
          // Always use the full completion text
          handleCompletion(request.completion, currentWord || request.lastWord, request.completion);
          
          console.log('AutoTab: Ghost text removed - Tab key pressed');
          removeGhostText();
          resetSuggestionState();
        } else if (e.key === 'Escape' || e.key === 'Enter') {
          console.log('AutoTab: Ghost text removed - Escape/Enter pressed');
          removeGhostText();
          resetSuggestionState();
        }
      }

      document.addEventListener('keydown', ghostKeydownHandler);

      // Remove event listener when ghost text is removed
      const ghostObserver = new MutationObserver((mutations) => {
        if (!document.body.contains(ghostText)) {
          document.removeEventListener('keydown', ghostKeydownHandler);
          ghostObserver.disconnect();
        }
      });

      ghostObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  } else {
    // Original tooltip behavior
    const tooltip = createTooltip(request.completion, false, false, request.alternatives);
    if (tooltip) {
      // Get the current state to check if we're typing the suggestion
      const content = getEditorContent(activeElement);
      const cursorPos = getCursorPosition(activeElement);
      const textBeforeCursor = content.slice(0, cursorPos);
      const currentWordMatch = textBeforeCursor.match(/\S+$/);
      const currentWord = currentWordMatch ? currentWordMatch[0] : '';
      
      // Get the completion text from any existing tooltip
      const existingTooltip = document.querySelector('.ai-autotab-tooltip');
      const existingCompletionElement = existingTooltip?.querySelector('.ai-autotab-completion');
      const existingRemainingText = existingCompletionElement?.textContent || '';
      
      // Check if we're currently typing the suggestion
      const isTypingSuggestion = existingRemainingText && 
        (existingRemainingText.toLowerCase().startsWith(currentWord.toLowerCase()) ||
         request.completion.toLowerCase().includes(textBeforeCursor.toLowerCase().trim()));
      
      if (!isTypingSuggestion) {
        // Only remove existing tooltips if we're not typing the suggestion
        document.querySelectorAll('.ai-autotab-tooltip').forEach(t => {
          console.log('AutoTab: Tooltip removed - New completion received (not typing suggestion)');
          t.remove();
        });
        removeGhostText();
        positionTooltip(tooltip, activeElement);

        // Store the full suggestion for reference
        currentSuggestion = request.completion;
        
        // Handle keyboard events for tooltip
        function keydownHandler(e) {
          if (e.key === 'Tab') {
            e.preventDefault();
            // Get the current completion text from the tooltip
            const completionElement = tooltip.querySelector('.ai-autotab-completion');
            const remainingText = completionElement?.textContent || '';
            
            // Get the current state
            const content = getEditorContent(activeElement);
            const cursorPos = getCursorPosition(activeElement);
            const textBeforeCursor = content.slice(0, cursorPos);
            const currentWordMatch = textBeforeCursor.match(/\S+$/);
            const currentWord = currentWordMatch ? currentWordMatch[0] : '';
            
            // Check if we're typing the suggestion
            const isTypingSuggestion = currentSuggestion && 
              currentSuggestion.toLowerCase().includes(textBeforeCursor.toLowerCase().trim());
            
            if (debug) {
              console.log('AutoTab: Tab key pressed in tooltip:', {
                remainingText,
                currentWord,
                textBeforeCursor,
                currentSuggestion,
                isTypingSuggestion,
                content,
                cursorPos
              });
            }
            
            if (isTypingSuggestion) {
              // Only insert the remaining text from the tooltip
              if (debug) {
                console.log('AutoTab: Applying remaining text:', {
                  remainingText,
                  currentWord,
                  lastWord: request.lastWord
                });
              }
              handleCompletion(remainingText, currentWord || request.lastWord, remainingText);
            } else {
              // If not typing suggestion, insert the full completion
              if (debug) {
                console.log('AutoTab: Applying full completion:', {
                  completion: request.completion,
                  currentWord,
                  lastWord: request.lastWord
                });
              }
              handleCompletion(request.completion, currentWord || request.lastWord, request.completion);
            }
            
            if (debug) {
              console.log('AutoTab: Tooltip removed - Tab key pressed');
            }
            tooltip.remove();
            resetSuggestionState();
          } else if (e.key >= '1' && e.key <= '9' && request.alternatives && request.alternatives[e.key - 1]) {
            e.preventDefault();
            if (debug) {
              console.log('AutoTab: Alternative selected:', {
                key: e.key,
                alternative: request.alternatives[e.key - 1],
                currentWord,
                lastWord: request.lastWord
              });
            }
            handleCompletion(request.alternatives[e.key - 1], currentWord || request.lastWord, request.alternatives[e.key - 1]);
            if (debug) {
              console.log('AutoTab: Tooltip removed - Alternative selected');
            }
            tooltip.remove();
            resetSuggestionState();
          } else if (e.key === 'Escape' || e.key === 'Enter') {
            if (debug) {
              console.log('AutoTab: Tooltip removed - ' + e.key + ' pressed');
            }
            tooltip.remove();
            resetSuggestionState();
          } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
            // Get the current state
            const content = getEditorContent(activeElement);
            const cursorPos = getCursorPosition(activeElement);
            const textBeforeCursor = content.slice(0, cursorPos);
            const currentWordMatch = textBeforeCursor.match(/\S+$/);
            const currentWord = currentWordMatch ? currentWordMatch[0] : '';
            
            // Get the completion text from the tooltip
            const completionElement = tooltip.querySelector('.ai-autotab-completion');
            const remainingText = completionElement?.textContent || '';
            
            if (e.key.length === 1) {
              // Check if the typed character matches the next expected character
              const isMatchingNextChar = remainingText.toLowerCase().startsWith(e.key.toLowerCase());
              
              if (debug) {
                console.log('AutoTab: Character match check:', {
                  typedChar: e.key,
                  remainingText,
                  isMatchingNextChar,
                  currentWord,
                  textBeforeCursor,
                  currentSuggestion
                });
              }
              
              if (isMatchingNextChar) {
                // Update the tooltip to show the remaining text after the matched character
                const newRemainingText = remainingText.slice(1);
                if (newRemainingText.trim()) {
                  if (debug) {
                    console.log('AutoTab: Updating tooltip:', {
                      oldText: remainingText,
                      newText: newRemainingText,
                      matchedChar: e.key
                    });
                  }
                  completionElement.textContent = newRemainingText;
                } else {
                  // If no more text to show, remove the tooltip
                  if (debug) {
                    console.log('AutoTab: Tooltip removed - No more text to show');
                  }
                  tooltip.remove();
                }
              } else {
                // Remove tooltip if typed character doesn't match
                if (debug) {
                  console.log('AutoTab: Character mismatch:', {
                    expected: remainingText[0],
                    typed: e.key
                  });
                  console.log('AutoTab: Tooltip removed - Character mismatch');
                }
                tooltip.remove();
              }
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
              // Remove tooltip on backspace/delete
              if (debug) {
                console.log('AutoTab: Key pressed:', {
                  key: e.key,
                  currentText: textBeforeCursor
                });
                console.log('AutoTab: Tooltip removed - Backspace/Delete pressed');
              }
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
      } else {
        // If we're typing the suggestion, keep the existing tooltip
        console.log('AutoTab: Keeping existing tooltip - Currently typing suggestion');
        tooltip.remove(); // Remove the new tooltip since we're keeping the existing one
        return;
      }
    } else {
      console.log('AutoTab: No tooltip created - No remaining text to show');
    }
  }

  if (request.type === 'COMPLETION_RECEIVED' && !request.error && request.completion) {
    currentSuggestion = request.completion;
    currentLastWord = request.lastWord;
  }
});

function createGhostText(completion, lastWord, completeWord = '') {
  if (!completion || !activeElement) {
    if (debug) {
      console.log('AutoTab: Ghost text creation skipped:', {
        reason: !completion ? 'No completion text' : 'No active element',
        completion,
        activeElement
      });
    }
    return null;
  }

  // Get the computed style of the input
  const computedStyle = window.getComputedStyle(activeElement);
  
  // Create ghost text element
  const ghostText = document.createElement('div');
  ghostText.className = 'ai-ghost-text';
  
  // Get the current word being typed
  const content = getEditorContent(activeElement);
  const cursorPos = getCursorPosition(activeElement);
  const textBeforeCursor = content.slice(0, cursorPos);
  const currentWordMatch = textBeforeCursor.match(/\S+$/);
  const currentWord = currentWordMatch ? currentWordMatch[0] : '';
  const afterCursor = content.slice(cursorPos);
  const fullTextBeforeCursor = textBeforeCursor.trim();
  const cursorHasSpace = textBeforeCursor.endsWith(' '); // Check if cursor is after a space

  if (debug) {
    console.log('AutoTab: Ghost text input state:', {
      content,
      cursorPos,
      textBeforeCursor,
      currentWord,
      afterCursor,
      fullTextBeforeCursor,
      completion,
      lastWord,
      completeWord,
      cursorHasSpace
    });
  }

  // Format the ghost text content
  let ghostTextContent = '';
  
  if (currentWord && completeWord) {
    // We have a complete word to match against
    const completeWords = completeWord.split(' ');
    const completionWords = completion.split(' ');
    const firstCompleteWord = completeWords[0].toLowerCase();
    
    if (completeWord.toLowerCase().startsWith(currentWord.toLowerCase())) {
      // Show remaining part of the first word without space
      ghostTextContent = completeWords[0].slice(currentWord.length);
      
      // Add any following words, but avoid duplication
      if (completeWords.length > 1) {
        // Add remaining words from completeWord
        ghostTextContent += ' ' + completeWords.slice(1).join(' ');
      } else if (completionWords.length > 1) {
        // Only add following words from completion if they're not already included
        ghostTextContent += ' ' + completionWords.slice(1).join(' ');
      }
    } else {
      // No match with complete word, check if we should add a space based on lastWord and cursor position
      const needsSpace = lastWord !== '' && !cursorHasSpace; // Only add space if we don't have one at cursor
      ghostTextContent = (needsSpace ? ' ' : '') + completion;
    }
  } else {
    // No current word or complete word reference
    // Only add space if we don't have one at cursor and we're not completing a partial word
    const needsSpace = lastWord !== '' && !cursorHasSpace;
    ghostTextContent = (needsSpace ? ' ' : '') + completion;
  }

  // Don't show empty ghost text
  if (!ghostTextContent.trim()) {
    if (debug) {
      console.log('AutoTab: Ghost text creation cancelled - Empty content');
    }
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
  const rect = activeElement.getBoundingClientRect();
  
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

  // Set ghost text styles for positioning
  ghostText.style.position = 'absolute';
  ghostText.style.zIndex = '999998'; // Just below tooltip
  ghostText.style.pointerEvents = 'none';
  ghostText.style.color = 'rgba(128, 128, 128, 0.8)';
  ghostText.style.whiteSpace = 'pre';
  ghostText.style.top = `${rect.top + window.scrollY}px`;
  ghostText.style.left = `${rect.left + textWidth}px`;
  
  // Add to DOM
  document.body.appendChild(ghostText);
  currentGhostText = ghostText;

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    ghostText.classList.add('dark-mode');
  }

  if (debug) {
    console.log('AutoTab: Ghost text created:', {
      content: ghostTextContent,
      position: {
        top: ghostText.style.top,
        left: ghostText.style.left
      },
      styles: {
        fontSize: ghostText.style.fontSize,
        fontFamily: ghostText.style.fontFamily,
        lineHeight: ghostText.style.lineHeight
      }
    });
  }

  return ghostText;
}

function removeGhostText() {
  if (currentGhostText) {
    if (debug) {
      const content = getEditorContent(activeElement);
      const cursorPos = getCursorPosition(activeElement);
      const textBeforeCursor = content.slice(0, cursorPos);
      const currentWordMatch = textBeforeCursor.match(/\S+$/);
      const currentWord = currentWordMatch ? currentWordMatch[0] : '';
      
      console.log('AutoTab: Removing ghost text:', {
        reason: 'removeGhostText called',
        currentWord,
        ghostTextContent: currentGhostText.textContent,
        textBeforeCursor,
        currentSuggestion,
        currentLastWord
      });
    }
    currentGhostText.remove();
    currentGhostText = null;
  }
}

// Helper function to add tooltip keydown handler
function addTooltipKeydownHandler(tooltip, completion, lastWord) {
  function keydownHandler(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      handleCompletion(completion, lastWord);
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
