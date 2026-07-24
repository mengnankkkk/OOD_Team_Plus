UPDATE skill_assets
SET local_path = '.agents/skills/pandadata-api',
    version = '0.0.12',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'pandadata-api';
