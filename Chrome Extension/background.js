"use strict";

let timer = null;
let textBoxContent = '';
let pageContent = '';
const API_URL = 'https://api.openai.com/v1/chat/completions';

// Schema for structured completion output
const completionSchema = {
  type: "object",
  properties: {
    completion: {
      type: "string",
      description: "The primary completion suggestion that continues naturally from the user's input"
    },
    lastWord: {
      type: "string",
      description: "The last complete word that this completion is continuing from"
    },
    alternatives: {
      type: "array",
      items: { type: "string" },
      description: "List of alternative completion suggestions"
    },
    confidence: {
      type: "number",
      description: "Confidence score between 0 and 1 for the primary completion"
    }
  },
  required: ["completion", "lastWord", "alternatives", "confidence"]
};

async function updateTextbox(request, sender) {
  try {
    console.log('AutoTab: Processing text update request');
    textBoxContent = request.textBoxContent;
    const cursorPosition = request.cursorPosition || textBoxContent.length;
    
    const settings = await chrome.storage.sync.get();
    // Use the context sent with the request instead of storage
    const context = request.context;

    if (!settings.apiKey) {
      throw new Error('API key not configured. Please set up your API key in the extension options.');
    }

    const context_text = `
    PAGE TITLE: ${context.title}
    PAGE DESCRIPTION: ${context.description}
    CURRENT FORM CONTEXT: ${context.formContext}
    NEARBY TEXT: ${context.nearbyContext}
    PAGE HEADINGS: ${context.headings}
    INPUT FIELD INFO:
      - Label: ${context.inputContext.label}
      - Placeholder: ${context.inputContext.placeholder}
      - Field Name: ${context.inputContext.name}
      - Field Type: ${context.inputContext.type}
    `;

    console.log('AutoTab: Preparing API request with context:', context_text);

    // Get the last word being typed
    const textBeforeCursor = textBoxContent.slice(0, cursorPosition);
    const words = textBeforeCursor.split(/\s+/);
    const lastWord = textBeforeCursor.match(/\S+$/)?.[0] || '';
    const isPartialWord = lastWord && !textBeforeCursor.endsWith(' ');

    // Add detailed logging
    console.log('AutoTab: Current Input Details:', {
      fullText: textBoxContent,
      cursorPosition: cursorPosition,
      textBeforeCursor: textBeforeCursor,
      lastWord: lastWord,
      isPartialWord: isPartialWord,
      words: words
    });

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        'model': 'gpt-4o-mini',
        'messages': [
          {
            "role": "system",
            "content": `You are an AI autocomplete assistant. Your task is to predict the next words that would naturally complete the user's input.

IMPORTANT: You must ONLY respond with a JSON object in this exact format:
{
  "completion": "your primary completion suggestion",
  "lastWord": "Return the final complete word from the original text that the continuation is based on. If the continuation is only a fragment of a word, return an empty string to indicate that no additional space should be added.",
  "alternatives": ["alternative1", "alternative2", "alternative3"],
  "confidence": 0.9
}

Rules:
1. The completion should continue naturally from the user's last word
2. Keep completions concise and natural (2-5 words)
3. Always provide exactly 3 alternatives
4. Confidence should be between 0 and 1
5. Consider the input field's context (label, placeholder, etc.) to provide relevant completions
6. Use nearby text and form context to understand the expected input
7. Return ONLY the JSON object, no other text
8. For lastWord: When the continuation completes a partially typed word (e.g. "s" becoming "some" or "giv" becoming "give"), return an empty string ("") to indicate that no additional space should be inserted before the new text.
9. For lastWord: When the continuation starts a new word following a complete word (e.g. "some" leading into "ideas"), return that complete word to indicate that a space should be added before the new text.`
          },
          {
            "role": "user",
            "content": `The webpage context is:
${context_text}

The user is typing (| is cursor): "${textBeforeCursor}|${textBoxContent.slice(cursorPosition)}"
Current text: "${textBoxContent}"
Last word being typed: "${lastWord}"
Is partial word: ${isPartialWord}

Based on the input field's context and nearby content, provide completion suggestions that naturally continue from the current text.`
          }
        ],
        'temperature': parseFloat(settings.modelTemp) || 0.3
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('AutoTab: API request failed:', errorData);
      throw new Error(errorData.error?.message || 'API request failed. Please try again.');
    }
    
    const data = await response.json();
    let result;
    try {
      // Parse the completion response as JSON
      const rawResponse = data.choices[0].message.content;
      // Send raw response to content script for logging
      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'LOG_MESSAGE',
        level: 'info',
        message: 'Raw AI Response:',
        data: rawResponse
      });

      result = JSON.parse(rawResponse);
      
      // Send parsed response to content script for logging
      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'LOG_MESSAGE',
        level: 'info',
        message: 'Parsed AI Response:',
        data: result
      });

    } catch (e) {
      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'LOG_MESSAGE',
        level: 'error',
        message: 'Failed to parse response as JSON:',
        data: e.toString()
      });

      // If parsing fails, use the raw completion
      result = {
        completion: data.choices[0].message.content.trim(),
        alternatives: [],
        confidence: 1.0
      };
    }

    if (!result.completion || result.completion.trim().length === 0) {
      console.log('AutoTab: No meaningful completion generated');
      return;
    }

    // Clean up the completion
    let completion = result.completion.trim();
    
    // Handle partial words correctly
    if (isPartialWord) {
      // Don't split words that are being typed
      const currentWordMatch = textBoxContent.match(/\S+$/);
      const currentWord = currentWordMatch ? currentWordMatch[0] : '';
      
      // Send word analysis to content script for logging
      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'LOG_MESSAGE',
        level: 'info',
        message: 'Word Analysis:',
        data: {
          currentWord,
          completion,
          lastWord,
          textBoxContent
        }
      });

      // Check if the completion is actually completing the current word
      const isCompletingWord = completion.toLowerCase().startsWith(currentWord.toLowerCase());

      if (isCompletingWord) {
        // If the completion already includes the partial word, use it as is
        if (completion.toLowerCase().startsWith(currentWord.toLowerCase())) {
          // Keep the completion as is
        } else {
          // Remove any leading spaces and combine
          completion = completion.replace(/^\s*/, '');
          if (completion && !completion.match(/^\W/)) {
            completion = currentWord + completion;
          }
        }
      } else {
        // If it's a new word, just use the completion as is
        completion = completion.trim();
      }
    }

    // Clean up alternatives
    const alternatives = (result.alternatives || []).map(alt => {
      let cleaned = alt.trim();
      if (isPartialWord) {
        const currentWord = textBoxContent.match(/\S+$/)?.[0] || '';
        
        // Apply the same word completion logic to alternatives
        const isCompletingWord = cleaned.toLowerCase().startsWith(currentWord.toLowerCase());

        if (isCompletingWord) {
          if (cleaned.toLowerCase().startsWith(currentWord.toLowerCase())) {
            // Keep the alternative as is
          } else {
            // Remove any leading spaces and combine
            cleaned = cleaned.replace(/^\s*/, '');
            if (cleaned && !cleaned.match(/^\W/)) {
              cleaned = currentWord + cleaned;
            }
          }
        } else {
          // If it's a new word, just use it as is
          cleaned = cleaned.trim();
        }
      }
      return cleaned;
    }).filter(alt => 
      alt !== completion && 
      alt.length > 0 && 
      alt.trim() !== lastWord &&
      alt.toLowerCase() !== lastWord.toLowerCase()
    );

    // Send processing results to content script for logging
    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'LOG_MESSAGE',
      level: 'info',
      message: 'Processing Results:',
      data: {
        originalCompletion: result.completion,
        processedCompletion: completion,
        originalAlternatives: result.alternatives,
        processedAlternatives: alternatives
      }
    });

    // Ensure we have exactly 3 unique alternatives
    const uniqueAlternatives = [...new Set(alternatives)]
      .filter(alt => alt && alt.trim().length > 0)
      .slice(0, 3);
    
    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'LOG_MESSAGE',
      level: 'info',
      message: 'Final completion being sent:',
      data: { completion, alternatives: uniqueAlternatives }
    });

    console.log('AutoTab: Sending completion to content script:', completion);
    chrome.tabs.sendMessage(
      sender.tab.id,
      {
        type: 'COMPLETION_RECEIVED',
        completion: completion,
        alternatives: uniqueAlternatives,
        confidence: result.confidence || 1.0,
        lastWord: result.lastWord || '',
        partialWord: lastWord,
        originalLength: textBoxContent.length
      }
    );
  } catch (error) {
    console.error('AutoTab Error:', error);
    chrome.tabs.sendMessage(
      sender.tab.id,
      {
        type: 'COMPLETION_RECEIVED',
        error: error.message
      }
    );
  }
}

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.type === 'TEXT_BOX_UPDATED') {
    console.log('AutoTab: Received text box update');
    
    // Skip if user hasn't typed since last completion
    if (request.hasTypedSinceCompletion === false) {
      console.log('AutoTab: Skipping update - no typing since last completion');
      return;
    }
    
    if (timer) {
      clearTimeout(timer);
    }
    
    timer = setTimeout(() => {
      updateTextbox(request, sender);
    }, 300);
  } else if (request.type === 'STORE_CONTEXT') {
    console.log('AutoTab: Storing new context');
    chrome.storage.local.set({context: request.context});
  }
});
