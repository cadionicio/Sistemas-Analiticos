-- PC08 · Migración 003 · Una cuenta puede tener varias vistas autorizadas (roles)
ALTER TABLE usuario ADD COLUMN roles TEXT NOT NULL DEFAULT '';
