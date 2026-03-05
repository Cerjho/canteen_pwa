-- Migration: Publish all existing menu_schedules so they remain visible
-- after adding the menu_status = 'published' filter on the parent side.
-- Without this, all existing menus (defaulting to 'draft') would disappear.

UPDATE menu_schedules
SET    menu_status = 'published'
WHERE  menu_status = 'draft'
  AND  scheduled_date >= CURRENT_DATE;
