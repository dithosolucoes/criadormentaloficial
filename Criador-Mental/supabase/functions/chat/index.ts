// FIX: Add Deno types reference to resolve Deno global object.
/// <reference types="https://esm.sh/@types/deno" />
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// FIX: Update to the new @google/genai package and import GoogleGenAI.
import { GoogleGenAI } from "https://esm.sh/@google/genai@^0.12.0";

// Add a CORS function
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Or specific origin
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const SYSTEM_INSTRUCTION = 'You are a helpful AI assistant specialized in brainstorming and refining creative ideas for mind maps.';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { history } = await req.json(); // Expecting an array of { role, text }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set in environment variables");
    }

    // FIX: Use new GoogleGenAI({ apiKey }) for initialization.
    const ai = new GoogleGenAI({ apiKey });

    // Convert frontend history format to genAI format
    const formattedHistory = history.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
    }));

    // The last message is the current prompt
    const lastMessage = formattedHistory.pop();
    if (!lastMessage || lastMessage.role !== 'user') {
        throw new Error("Last message must be from the user.");
    }

    // FIX: Use the new ai.chats.create API.
    const chat = ai.chats.create({
        // FIX: Use a supported model like gemini-2.5-flash.
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: SYSTEM_INSTRUCTION
        },
        history: formattedHistory,
    });

    // FIX: Pass message content as a string.
    const response = await chat.sendMessage(lastMessage.parts[0].text);
    // FIX: Access the response text via the .text property.
    const text = response.text;

    return new Response(JSON.stringify({ response: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})