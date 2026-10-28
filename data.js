// Demo data for the SNARE prototype. Every price, deal, recipe rating and scan
// result here is made up for the demo. To plug in real data later, replace
// these arrays but keep the same fields; app.js only depends on them.
window.SNARE_DATA = {
  // Starting points (London, Ontario)
  areas: [
    { id: 'campus', name: 'Western campus', lat: 43.0096, lng: -81.2737 },
    { id: 'fanshawe', name: 'Fanshawe College', lat: 43.0128, lng: -81.2000 },
    { id: 'downtown', name: 'Downtown', lat: 42.9849, lng: -81.2453 },
    { id: 'oldeast', name: 'Old East Village', lat: 42.9890, lng: -81.2240 },
    { id: 'masonville', name: 'Masonville', lat: 43.0250, lng: -81.2800 },
    { id: 'whiteoaks', name: 'White Oaks', lat: 42.9300, lng: -81.2300 },
    { id: 'byron', name: 'Byron', lat: 42.9620, lng: -81.3330 },
  ],

  // factor: how pricey the store is overall. carries: null means everything,
  // otherwise only these product categories.
  stores: [
    { id: 'nofrills', name: 'No Frills', where: 'Dundas St', lat: 42.9860, lng: -81.2300, factor: 0.90, carries: null },
    { id: 'freshco', name: 'FreshCo', where: 'Hamilton Rd', lat: 42.9750, lng: -81.2150, factor: 0.91, carries: null },
    { id: 'foodbasics', name: 'Food Basics', where: 'Adelaide St N', lat: 43.0010, lng: -81.2390, factor: 0.93, carries: null },
    { id: 'walmart', name: 'Walmart Supercentre', where: 'Wellington Rd', lat: 42.9350, lng: -81.2260, factor: 0.94, carries: null },
    { id: 'metro', name: 'Metro', where: 'Oxford St W', lat: 42.9800, lng: -81.3000, factor: 1.07, carries: null },
    { id: 'loblaws', name: 'Loblaws', where: 'Fanshawe Park Rd', lat: 43.0270, lng: -81.2820, factor: 1.10, carries: null },
    { id: 'market', name: 'Western Fair Farmers Market', where: 'King St', lat: 42.9880, lng: -81.2210, factor: 0.95, carries: ['produce', 'bakery', 'eggs'] },
  ],

  // base: typical regular price. life: days it usually keeps as bought (fresh or
  // unopened). open: days once opened. freeze: days in the freezer. Loosely
  // based on USDA FoodKeeper and Health Canada guidance. flags drive diet
  // filters. swap: cheaper alternative.
  products: [
    { id: 'bananas', name: 'Bananas', unit: 'about 2 lb', cat: 'produce', base: 1.69, life: 5, freeze: 90 },
    { id: 'apples', name: 'Apples', unit: '3 lb bag', cat: 'produce', base: 4.99, life: 30 },
    { id: 'carrots', name: 'Carrots', unit: '2 lb bag', cat: 'produce', base: 2.49, life: 21 },
    { id: 'potatoes', name: 'Potatoes', unit: '10 lb bag', cat: 'produce', base: 6.49, life: 30 },
    { id: 'onions', name: 'Onions', unit: '3 lb bag', cat: 'produce', base: 3.49, life: 30 },
    { id: 'garlic', name: 'Garlic', unit: '1 bulb', cat: 'produce', base: 0.99, life: 60 },
    { id: 'spinach', name: 'Fresh spinach', unit: '312 g bag', cat: 'produce', base: 4.49, life: 5, swap: 'frozen_spinach', freeze: 180 },
    { id: 'tomatoes', name: 'Tomatoes', unit: '1 lb', cat: 'produce', base: 2.99, life: 7 },
    { id: 'lettuce', name: 'Romaine lettuce', unit: 'each', cat: 'produce', base: 2.99, life: 7, keywords: 'salad' },
    { id: 'broccoli', name: 'Broccoli', unit: 'each', cat: 'produce', base: 2.99, life: 5, swap: 'frozen_veg' },
    { id: 'bell_pepper', name: 'Bell pepper', unit: 'each', cat: 'produce', base: 1.49, life: 7, keywords: 'red pepper', freeze: 240 },
    { id: 'mushrooms', name: 'Mushrooms', unit: '227 g', cat: 'produce', base: 2.99, life: 5, keywords: 'mushroom', freeze: 240 },
    { id: 'cucumber', name: 'Cucumber', unit: 'each', cat: 'produce', base: 1.29, life: 7 },
    { id: 'green_onions', name: 'Green onions', unit: 'bunch', cat: 'produce', base: 1.29, life: 7, keywords: 'scallions' },
    { id: 'frozen_spinach', name: 'Frozen spinach', unit: '300 g', cat: 'frozen', base: 2.29, life: 240 },
    { id: 'frozen_veg', name: 'Frozen mixed vegetables', unit: '750 g', cat: 'frozen', base: 2.79, life: 240, keywords: 'veggies peas' },
    { id: 'milk', name: 'Milk 2%', unit: '2 L', cat: 'dairy', base: 5.49, life: 12, flags: ['dairy'], open: 7, freeze: 90 },
    { id: 'cheddar', name: 'Cheddar cheese', unit: '400 g', cat: 'dairy', base: 7.49, life: 42, flags: ['dairy'], keywords: 'cheese', open: 28, freeze: 180 },
    { id: 'yogurt', name: 'Plain yogurt', unit: '750 g', cat: 'dairy', base: 4.29, life: 14, flags: ['dairy'], keywords: 'yoghurt sour cream', open: 7, freeze: 60 },
    { id: 'butter', name: 'Butter', unit: '454 g', cat: 'dairy', base: 6.99, life: 60, flags: ['dairy'], open: 30, freeze: 270 },
    { id: 'eggs', name: 'Eggs', unit: 'dozen large', cat: 'eggs', base: 4.29, life: 28, flags: ['egg'], keywords: 'egg' },
    { id: 'chicken_thighs', name: 'Chicken thighs', unit: '1 kg', cat: 'meat', base: 10.99, life: 2, flags: ['meat'], keywords: 'chicken', freeze: 270 },
    { id: 'chicken_breast', name: 'Chicken breasts', unit: '1 kg', cat: 'meat', base: 15.99, life: 2, flags: ['meat'], swap: 'chicken_thighs', keywords: 'chicken', freeze: 270 },
    { id: 'ground_beef', name: 'Ground beef', unit: '450 g', cat: 'meat', base: 6.99, life: 2, flags: ['meat'], keywords: 'beef meat', freeze: 120 },
    { id: 'tofu', name: 'Firm tofu', unit: '350 g', cat: 'protein', base: 3.29, life: 30, open: 4, freeze: 150 },
    { id: 'lentils', name: 'Red lentils', unit: '900 g', cat: 'pantry', base: 3.99, life: 365 },
    { id: 'black_beans', name: 'Black beans', unit: '540 ml can', cat: 'pantry', base: 1.49, life: 365, keywords: 'beans' },
    { id: 'tuna', name: 'Canned tuna', unit: '170 g', cat: 'pantry', base: 1.79, life: 365, flags: ['fish'], keywords: 'fish' },
    { id: 'pasta', name: 'Spaghetti', unit: '900 g', cat: 'pantry', base: 2.49, life: 365, flags: ['gluten'], keywords: 'pasta noodles' },
    { id: 'pasta_sauce', name: 'Pasta sauce', unit: '680 ml', cat: 'pantry', base: 2.99, life: 365, keywords: 'tomato sauce marinara', open: 5, freeze: 180 },
    { id: 'rice', name: 'White rice', unit: '2 kg', cat: 'pantry', base: 5.99, life: 365 },
    { id: 'oats', name: 'Large flake oats', unit: '1 kg', cat: 'pantry', base: 4.29, life: 365, keywords: 'oatmeal' },
    { id: 'salsa', name: 'Salsa', unit: '650 ml jar', cat: 'pantry', base: 3.49, life: 180, open: 14 },
    { id: 'bread', name: 'Whole wheat bread', unit: '675 g', cat: 'bakery', base: 3.49, life: 7, flags: ['gluten'], freeze: 90 },
    { id: 'tortillas', name: 'Flour tortillas', unit: '10 pack', cat: 'bakery', base: 3.99, life: 14, flags: ['gluten'], keywords: 'wraps', open: 7, freeze: 180 },
    // Leftovers can be in a fridge but are never on a shopping list.
    { id: 'leftovers', name: 'Leftovers', unit: 'container', cat: 'leftover', base: 3.00, life: 4, leftover: true, freeze: 90 },
    { id: 'cooked_rice', name: 'Leftover rice', unit: 'container', cat: 'leftover', base: 1.00, life: 4, leftover: true, keywords: 'leftovers', freeze: 180 },
  ],

  // This week's flyer deals
  deals: [
    { store: 'foodbasics', product: 'chicken_thighs', price: 7.99 },
    { store: 'nofrills', product: 'ground_beef', price: 4.99 },
    { store: 'nofrills', product: 'bell_pepper', price: 0.79 },
    { store: 'nofrills', product: 'salsa', price: 2.49 },
    { store: 'freshco', product: 'tortillas', price: 2.49 },
    { store: 'freshco', product: 'black_beans', price: 0.99 },
    { store: 'freshco', product: 'rice', price: 3.99 },
    { store: 'foodbasics', product: 'pasta', price: 1.49 },
    { store: 'foodbasics', product: 'eggs', price: 3.49 },
    { store: 'walmart', product: 'milk', price: 4.79 },
    { store: 'walmart', product: 'tofu', price: 2.49 },
    { store: 'metro', product: 'cheddar', price: 5.99 },
    { store: 'loblaws', product: 'broccoli', price: 1.49 },
    { store: 'market', product: 'mushrooms', price: 1.99 },
    { store: 'market', product: 'spinach', price: 2.99 },
  ],

  // Surplus and near expiry offers. kg is used for the food rescued total.
  rescue: [
    { id: 'r1', cat: 'Produce', kg: 1.4, store: 'market', name: 'Imperfect produce bag', size: '3 lb', price: 3.00, was: 7.50, note: 'Bruised but great for soups' },
    { id: 'r2', cat: 'Bakery', kg: 1.35, store: 'nofrills', name: 'Bakery bread', size: '2 loaves', price: 2.50, was: 6.98, note: 'Best before tomorrow' },
    { id: 'r3', cat: 'Meat', kg: 1.0, store: 'foodbasics', name: 'Chicken drumsticks', size: '1 kg', price: 5.49, was: 10.99, note: 'Best before Nov 1' },
    { id: 'r4', cat: 'Produce', kg: 0.31, store: 'loblaws', name: 'Mixed salad greens', size: '312 g', price: 1.99, was: 4.99, note: 'Best before Oct 30' },
    { id: 'r5', cat: 'Dairy', kg: 0.8, store: 'metro', name: 'Yogurt cups', size: '8 pack', price: 2.99, was: 6.49, note: 'Best before Nov 2' },
    { id: 'r6', cat: 'Produce', kg: 0.9, store: 'freshco', name: 'Very ripe bananas', size: '2 lb', price: 0.99, was: 1.99, note: 'Perfect for pancakes' },
    { id: 'r7', cat: 'Prepared', kg: 0.9, store: 'walmart', name: 'Rotisserie chicken', size: 'whole', price: 6.00, was: 11.97, note: 'Cooked today' },
  ],

  // Student friendly recipes. opt: optional ingredient. alt: other products
  // that count as having it. pop: share of students who liked it (demo figure,
  // standing in for what the real app would learn from everyone's feedback).
  recipes: [
    { id: 'omelette', name: 'Spinach and Cheddar Omelette', time: 10, serves: 1, meal: 'breakfast', pop: 78,
      ingredients: [{ id: 'eggs', amt: '3' }, { id: 'spinach', amt: '1 handful', alt: ['frozen_spinach'] }, { id: 'cheddar', amt: '1/4 cup' }, { id: 'bread', amt: '2 slices', opt: true }],
      steps: ['Whisk the eggs with a pinch of salt.', 'Wilt the spinach in an oiled pan for 1 minute.', 'Pour in the eggs and cook until almost set.', 'Add the cheddar, fold in half and serve with toast.'] },
    { id: 'friedrice', name: 'Leftover Egg Fried Rice', time: 15, serves: 2, meal: 'dinner', pop: 88,
      ingredients: [{ id: 'cooked_rice', amt: '2 cups', alt: ['rice'] }, { id: 'eggs', amt: '2' }, { id: 'frozen_veg', amt: '1 cup' }, { id: 'green_onions', amt: '2 stalks', opt: true }],
      steps: ['Heat oil in a big pan until very hot.', 'Fry the vegetables for 3 minutes.', 'Add the cold rice and fry until it crackles.', 'Push it aside, scramble the eggs, then mix everything with soy sauce.'] },
    { id: 'quesadilla', name: 'Black Bean Quesadillas', time: 15, serves: 2, meal: 'dinner', pop: 85,
      ingredients: [{ id: 'tortillas', amt: '4' }, { id: 'black_beans', amt: '1 can' }, { id: 'cheddar', amt: '1 cup' }, { id: 'bell_pepper', amt: '1' }, { id: 'salsa', amt: 'to serve', opt: true }],
      steps: ['Drain and lightly mash the beans.', 'Slice the pepper thinly.', 'Fill half of each tortilla with beans, pepper and cheese, then fold.', 'Toast in a dry pan for 2 to 3 minutes a side.'] },
    { id: 'burritobowl', name: 'Chicken Burrito Bowl', time: 25, serves: 3, meal: 'dinner', pop: 90,
      ingredients: [{ id: 'chicken_thighs', amt: '500 g' }, { id: 'rice', amt: '1.5 cups', alt: ['cooked_rice'] }, { id: 'black_beans', amt: '1 can' }, { id: 'salsa', amt: '1/2 cup' }, { id: 'lettuce', amt: '2 cups' }, { id: 'cheddar', amt: 'a handful', opt: true }],
      steps: ['Cook the rice.', 'Season the chicken with salt, pepper and chili powder, then pan fry 6 minutes a side.', 'Warm the beans.', 'Slice the chicken and build bowls with rice, beans, lettuce and salsa.'] },
    { id: 'stirfry', name: 'Chicken and Veggie Stir Fry', time: 25, serves: 3, meal: 'dinner', pop: 80,
      ingredients: [{ id: 'chicken_thighs', amt: '500 g' }, { id: 'broccoli', amt: '1 head', alt: ['frozen_veg'] }, { id: 'carrots', amt: '2' }, { id: 'garlic', amt: '2 cloves' }, { id: 'rice', amt: '1.5 cups', alt: ['cooked_rice'] }],
      steps: ['Cook the rice.', 'Slice the chicken and vegetables into bite size pieces.', 'Stir fry the chicken until golden, then add the vegetables and garlic.', 'Finish with soy sauce and a splash of water. Serve over rice.'] },
    { id: 'tomatopasta', name: 'One Pot Tomato Spinach Pasta', time: 20, serves: 3, meal: 'dinner', pop: 82,
      ingredients: [{ id: 'pasta', amt: '300 g' }, { id: 'pasta_sauce', amt: '1 jar' }, { id: 'spinach', amt: '2 handfuls', alt: ['frozen_spinach'] }, { id: 'onions', amt: '1' }, { id: 'garlic', amt: '2 cloves' }, { id: 'cheddar', amt: 'to top', opt: true }],
      steps: ['Soften the chopped onion and garlic in a large pot.', 'Add the sauce, pasta and 3 cups of water.', 'Simmer for 12 minutes, stirring often.', 'Stir in the spinach until wilted.'] },
    { id: 'shakshuka', name: 'Shakshuka', time: 25, serves: 2, meal: 'breakfast', pop: 70,
      ingredients: [{ id: 'eggs', amt: '4' }, { id: 'tomatoes', amt: '4' }, { id: 'onions', amt: '1' }, { id: 'bell_pepper', amt: '1' }, { id: 'garlic', amt: '2 cloves' }, { id: 'bread', amt: 'to dip', opt: true }],
      steps: ['Soften the onion, pepper and garlic.', 'Add chopped tomatoes, cumin and paprika and simmer 10 minutes.', 'Make 4 wells and crack in the eggs.', 'Cover and cook until the whites set.'] },
    { id: 'lentilcurry', name: 'Red Lentil Curry', time: 35, serves: 4, meal: 'dinner', pop: 74,
      ingredients: [{ id: 'lentils', amt: '1 cup' }, { id: 'onions', amt: '1' }, { id: 'garlic', amt: '3 cloves' }, { id: 'tomatoes', amt: '2' }, { id: 'spinach', amt: '2 handfuls', alt: ['frozen_spinach'] }, { id: 'rice', amt: 'to serve', opt: true, alt: ['cooked_rice'] }],
      steps: ['Soften the onion and garlic with curry powder.', 'Add the lentils, tomatoes and 3 cups of water.', 'Simmer for 20 minutes until thick.', 'Stir in the spinach and serve with rice.'] },
    { id: 'tacos', name: 'Beef Tacos', time: 20, serves: 3, meal: 'dinner', pop: 86,
      ingredients: [{ id: 'ground_beef', amt: '450 g' }, { id: 'tortillas', amt: '6' }, { id: 'lettuce', amt: '1 cup' }, { id: 'tomatoes', amt: '2' }, { id: 'cheddar', amt: '1/2 cup' }, { id: 'salsa', amt: 'to serve', opt: true }],
      steps: ['Brown the beef with chili powder, cumin and salt.', 'Chop the lettuce and tomatoes.', 'Warm the tortillas in a dry pan.', 'Fill and top with cheese and salsa.'] },
    { id: 'tofubowl', name: 'Crispy Tofu Rice Bowl', time: 25, serves: 2, meal: 'dinner', pop: 66,
      ingredients: [{ id: 'tofu', amt: '1 block' }, { id: 'rice', amt: '1 cup', alt: ['cooked_rice'] }, { id: 'broccoli', amt: '1 head', alt: ['frozen_veg'] }, { id: 'carrots', amt: '1' }, { id: 'green_onions', amt: '2 stalks', opt: true }],
      steps: ['Press and cube the tofu, then toss with cornstarch.', 'Pan fry until crispy on all sides.', 'Steam or stir fry the vegetables.', 'Serve over rice with soy sauce.'] },
    { id: 'pancakes', name: 'Banana Oat Pancakes', time: 15, serves: 2, meal: 'breakfast', pop: 79,
      ingredients: [{ id: 'bananas', amt: '2 ripe' }, { id: 'eggs', amt: '2' }, { id: 'oats', amt: '1 cup' }, { id: 'milk', amt: '1/2 cup' }],
      steps: ['Blend or mash everything into a batter.', 'Rest for 5 minutes.', 'Cook small pancakes in a buttered pan, 2 minutes a side.'] },
    { id: 'potatoes', name: 'Loaded Microwave Potatoes', time: 20, serves: 2, meal: 'dinner', pop: 72,
      ingredients: [{ id: 'potatoes', amt: '2 large' }, { id: 'cheddar', amt: '1/2 cup' }, { id: 'broccoli', amt: '1 cup', alt: ['frozen_veg'] }, { id: 'yogurt', amt: '1/4 cup' }, { id: 'green_onions', amt: '1 stalk', opt: true }],
      steps: ['Prick the potatoes and microwave 8 to 10 minutes until soft.', 'Steam the broccoli.', 'Split the potatoes, fluff and add cheese.', 'Top with broccoli, yogurt and green onion.'] },
    { id: 'tunapasta', name: 'Tuna Pasta Salad', time: 15, serves: 3, meal: 'lunch', pop: 60,
      ingredients: [{ id: 'pasta', amt: '250 g' }, { id: 'tuna', amt: '1 can' }, { id: 'cucumber', amt: '1' }, { id: 'yogurt', amt: '1/3 cup' }, { id: 'green_onions', amt: '2 stalks', opt: true }],
      steps: ['Cook and cool the pasta.', 'Dice the cucumber.', 'Mix the tuna, yogurt, salt and pepper.', 'Toss everything together and chill.'] },
    { id: 'mushroompasta', name: 'Creamy Mushroom Spinach Pasta', time: 20, serves: 3, meal: 'dinner', pop: 77,
      ingredients: [{ id: 'pasta', amt: '300 g' }, { id: 'mushrooms', amt: '1 pack' }, { id: 'spinach', amt: '2 handfuls', alt: ['frozen_spinach'] }, { id: 'garlic', amt: '2 cloves' }, { id: 'milk', amt: '1 cup' }, { id: 'cheddar', amt: '1/2 cup' }],
      steps: ['Cook the pasta.', 'Brown the sliced mushrooms with garlic.', 'Add milk and cheese and simmer until creamy.', 'Stir in the spinach and pasta.'] },
    { id: 'parfait', name: 'Yogurt Fruit Parfait', time: 5, serves: 1, meal: 'breakfast', pop: 68,
      ingredients: [{ id: 'yogurt', amt: '1 cup' }, { id: 'bananas', amt: '1' }, { id: 'apples', amt: '1' }, { id: 'oats', amt: '1/4 cup' }],
      steps: ['Chop the fruit.', 'Layer yogurt, fruit and oats in a glass or container.'] },
    { id: 'frenchtoast', name: 'French Toast', time: 15, serves: 2, meal: 'breakfast', pop: 81,
      ingredients: [{ id: 'bread', amt: '4 slices' }, { id: 'eggs', amt: '2' }, { id: 'milk', amt: '1/2 cup' }, { id: 'bananas', amt: 'to top', opt: true }],
      steps: ['Whisk the eggs, milk and a pinch of cinnamon.', 'Soak each slice for a few seconds.', 'Cook in a buttered pan until golden on both sides.'] },
    { id: 'beefchili', name: 'Beef and Bean Chili', time: 35, serves: 4, meal: 'dinner', pop: 87,
      ingredients: [{ id: 'ground_beef', amt: '450 g' }, { id: 'tomatoes', amt: '4' }, { id: 'black_beans', amt: '1 can' }, { id: 'onions', amt: '1' }, { id: 'garlic', amt: '2 cloves' }, { id: 'bell_pepper', amt: '1', opt: true }, { id: 'cheddar', amt: 'to top', opt: true }],
      steps: ['Brown the beef in a large pot, then add the chopped onion and garlic.', 'Stir in chili powder, cumin and salt.', 'Add the chopped tomatoes and drained beans with a splash of water.', 'Simmer for 20 minutes. Freezes well for later in the week.'] },
    { id: 'chili', name: 'Black Bean Veggie Chili', time: 35, serves: 4, meal: 'dinner', pop: 71,
      ingredients: [{ id: 'black_beans', amt: '2 cans' }, { id: 'tomatoes', amt: '3' }, { id: 'onions', amt: '1' }, { id: 'bell_pepper', amt: '1' }, { id: 'carrots', amt: '2' }, { id: 'rice', amt: 'to serve', opt: true, alt: ['cooked_rice'] }],
      steps: ['Soften the onion, pepper and carrots with chili powder.', 'Add the beans and chopped tomatoes.', 'Simmer for 20 minutes.', 'Serve on rice or with bread.'] },
    { id: 'wraps', name: 'Chicken Veggie Wraps', time: 15, serves: 2, meal: 'lunch', pop: 76,
      ingredients: [{ id: 'chicken_thighs', amt: '300 g' }, { id: 'tortillas', amt: '4' }, { id: 'lettuce', amt: '1 cup' }, { id: 'cucumber', amt: '1/2' }, { id: 'yogurt', amt: '1/4 cup' }],
      steps: ['Pan fry the seasoned chicken and slice it.', 'Mix the yogurt with garlic, salt and lemon for a sauce.', 'Fill the tortillas with chicken, lettuce and cucumber.', 'Add sauce, roll up and toast if you like.'] },
  ],

  // What the simulated AI "finds" in the demo fridge photo. days: days left.
  // label: the date was read off the package, so it is exact. conf: model
  // confidence. box: where it sits in the demo image (%).
  demoScan: [
    { id: 'chicken_thighs', qty: '500 g pack', days: 1, label: true, opened: false, conf: 0.94, box: [8, 70, 40, 18] },
    { id: 'spinach', qty: 'Half a bag', days: 2, conf: 0.91, box: [52, 41, 40, 17] },
    { id: 'milk', qty: 'Half a carton', days: 3, label: true, opened: true, conf: 0.97, box: [8, 6, 22, 28] },
    { id: 'eggs', qty: '8 left', days: 12, conf: 0.95, box: [34, 18, 58, 13] },
    { id: 'cheddar', qty: '1 block', days: 16, conf: 0.88, box: [8, 43, 22, 13] },
    { id: 'yogurt', qty: '1 tub', days: 4, label: true, opened: true, conf: 0.83, box: [33, 40, 17, 18] },
    { id: 'bell_pepper', qty: '1', days: 3, conf: 0.79, box: [54, 72, 16, 16] },
    { id: 'tortillas', qty: 'Half a pack', days: 6, label: true, opened: true, conf: 0.72, box: [72, 70, 22, 18] },
    { id: 'cooked_rice', qty: '1 container', days: 2, conf: 0.61, box: [60, 4, 32, 12] },
  ],

  // Single item scans: each photo returns the next guess in this list. alts
  // are what the user can tap if the guess is wrong.
  itemScans: [
    { id: 'ground_beef', qty: '450 g pack', days: 1, label: true, conf: 0.9, alts: ['chicken_thighs', 'tofu'] },
    { id: 'tomatoes', qty: '4', days: 3, conf: 0.93, alts: ['bell_pepper', 'apples'] },
    { id: 'spinach', qty: 'Half a bag', days: 2, conf: 0.88, alts: ['lettuce', 'green_onions'] },
    { id: 'cheddar', qty: '1 block', days: 16, conf: 0.86, alts: ['butter', 'yogurt'] },
    { id: 'eggs', qty: '6 left', days: 12, conf: 0.95, alts: ['potatoes', 'milk'] },
  ],

  // Roommates' food, shown when the shared house fridge is on.
  housemates: ['Maya', 'Jordan'],
  houseItems: [
    { id: 'mushrooms', qty: '1 pack', days: 2, owner: 'Maya' },
    { id: 'ground_beef', qty: '450 g', days: 1, owner: 'Jordan' },
    { id: 'green_onions', qty: '1 bunch', days: 4, owner: 'Shared' },
    { id: 'butter', qty: 'Half a block', days: 20, owner: 'Shared' },
  ],
};
