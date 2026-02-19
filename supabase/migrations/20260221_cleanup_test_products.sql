-- Cleanup: remove junk test products that were created during manual testing
DELETE FROM products
WHERE name !~ '^[A-Z]'  -- Product names that don't start with an uppercase letter
  AND name NOT IN (
    'Chicken Adobo Rice Bowl', 'Spaghetti Bolognese', 'Pork Sisig Rice',
    'Beef Tapa Meal', 'Chicken Inasal Plate',
    'Lumpiang Shanghai', 'Cheese Sticks', 'Banana Cue',
    'Chicken Empanada', 'French Fries',
    'Mango Shake', 'Buko Juice', 'Iced Tea',
    'Calamansi Juice', 'Hot Chocolate'
  );
