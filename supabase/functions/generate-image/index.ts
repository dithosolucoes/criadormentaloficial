// FIX: Add Deno types reference to resolve Deno global object.
/// <reference types="https://esm.sh/@types/deno" />
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { GoogleGenAI, Modality } from "https://esm.sh/@google/genai@^0.12.0";

// Add a CORS function
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Or specific origin
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageData, prompt, mimeType } = await req.json();

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables");
    }

    const ai = new GoogleGenAI({ apiKey });

    const contents = {
      parts: [
        { inlineData: { data: imageData, mimeType: mimeType } },
        { text: prompt },
      ],
    };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents,
      config: { responseModalities: [Modality.IMAGE] },
    });

    const imagePartResponse = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData
    )?.inlineData;

    if (!imagePartResponse) {
      throw new Error('AI did not return a valid image.');
    }

    return new Response(JSON.stringify(imagePartResponse), {
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