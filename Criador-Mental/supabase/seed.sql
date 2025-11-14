-- This seed file provides example data for the Criador Mental application.
-- IMPORTANT: 
-- 1. Sign up for a new user account in the application first.
-- 2. Get the User ID for your new account from the Supabase Studio (Authentication > Users).
-- 3. Replace the placeholder '<REPLACE_WITH_YOUR_USER_ID>' with your actual User ID.
-- 4. Run `supabase db reset` in your terminal to apply this seed data.

-- Delete existing projects for the user to ensure a clean slate.
-- Make sure to wrap the UUID in single quotes.
DELETE FROM public.projects WHERE user_id = '<REPLACE_WITH_YOUR_USER_ID>'::uuid;

-- Insert a sample project
INSERT INTO public.projects (user_id, name, pages, active_page_index)
VALUES (
    '<REPLACE_WITH_YOUR_USER_ID>'::uuid,
    'Meu Primeiro Mapa Mental',
    '[
        {
            "id": "master",
            "name": "Master",
            "keywords": [],
            "versions": [],
            "instructions": [],
            "contextPageIds": [],
            "generatedImage": null
        },
        {
            "id": "17223456789",
            "name": "Ideia Inicial",
            "keywords": ["Cérebro", "Conexões", "Luz", "Criatividade"],
            "versions": [],
            "instructions": ["Desenhar um cérebro com ideias saindo como raios de luz.", "Usar um estilo de rascunho, como se fosse feito à mão."],
            "contextPageIds": [],
            "generatedImage": null
        }
    ]',
    1
);

-- Insert another sample project
INSERT INTO public.projects (user_id, name, pages, active_page_index)
VALUES (
    '<REPLACE_WITH_YOUR_USER_ID>'::uuid,
    'Plano de Negócios',
    '[
        {
            "id": "master",
            "name": "Master",
            "keywords": [],
            "versions": [],
            "instructions": [],
            "contextPageIds": [],
            "generatedImage": null
        },
        {
            "id": "9876543210",
            "name": "Marketing",
            "keywords": ["Funil de Vendas", "Redes Sociais", "Anúncios"],
            "versions": [],
            "instructions": ["Mostrar um funil com ícones para Instagram, Facebook e Google Ads."],
            "contextPageIds": [],
            "generatedImage": null
        }
    ]',
    0
);