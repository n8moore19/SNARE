// Demo data for the SNARE prototype. Every price, deal, rescue offer and food
// support listing here is made up for the demo. To plug in real data later,
// replace these arrays but keep the same fields; app.js only depends on them.
window.SNARE_DATA = {
  // Starting points (London, Ontario)
  areas: [
    { id: 'downtown', name: 'Downtown', lat: 42.9849, lng: -81.2453 },
    { id: 'oldeast', name: 'Old East Village', lat: 42.9890, lng: -81.2240 },
    { id: 'masonville', name: 'Masonville', lat: 43.0250, lng: -81.2800 },
    { id: 'campus', name: 'Western campus', lat: 43.0096, lng: -81.2737 },
    { id: 'whiteoaks', name: 'White Oaks', lat: 42.9300, lng: -81.2300 },
    { id: 'byron', name: 'Byron', lat: 42.9620, lng: -81.3330 },
    { id: 'argyle', name: 'Argyle', lat: 43.0000, lng: -81.1900 },
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

  // base: typical regular price. swap: a cheaper product that does the same job.
  products: [
    { id: 'bananas', name: 'Bananas', unit: 'about 2 lb', cat: 'produce', base: 1.69 },
    { id: 'apples', name: 'Apples', unit: '3 lb bag', cat: 'produce', base: 4.99 },
    { id: 'carrots', name: 'Carrots', unit: '2 lb bag', cat: 'produce', base: 2.49 },
    { id: 'potatoes', name: 'Potatoes', unit: '10 lb bag', cat: 'produce', base: 6.49 },
    { id: 'onions', name: 'Onions', unit: '3 lb bag', cat: 'produce', base: 3.49 },
    { id: 'spinach', name: 'Fresh spinach', unit: '312 g', cat: 'produce', base: 4.49, swap: 'frozen_spinach' },
    { id: 'tomatoes', name: 'Tomatoes', unit: '1 lb', cat: 'produce', base: 2.99 },
    { id: 'lettuce', name: 'Romaine lettuce', unit: 'each', cat: 'produce', base: 2.99, keywords: 'salad' },
    { id: 'broccoli', name: 'Broccoli', unit: 'each', cat: 'produce', base: 2.99, swap: 'frozen_veg' },
    { id: 'frozen_spinach', name: 'Frozen spinach', unit: '300 g', cat: 'frozen', base: 2.29 },
    { id: 'frozen_veg', name: 'Frozen mixed vegetables', unit: '750 g', cat: 'frozen', base: 2.79, keywords: 'veggies' },
    { id: 'milk', name: 'Milk 2%', unit: '2 L', cat: 'dairy', base: 5.49 },
    { id: 'eggs', name: 'Eggs', unit: 'dozen large', cat: 'eggs', base: 4.29 },
    { id: 'butter', name: 'Butter', unit: '454 g', cat: 'dairy', base: 6.99 },
    { id: 'cheddar', name: 'Cheddar cheese', unit: '400 g', cat: 'dairy', base: 7.49, keywords: 'cheese' },
    { id: 'yogurt', name: 'Plain yogurt', unit: '750 g', cat: 'dairy', base: 4.29, keywords: 'yoghurt' },
    { id: 'chicken_breast', name: 'Chicken breasts', unit: '1 kg', cat: 'meat', base: 15.99, swap: 'chicken_thighs', keywords: 'meat' },
    { id: 'chicken_thighs', name: 'Chicken thighs', unit: '1 kg', cat: 'meat', base: 10.99, keywords: 'meat' },
    { id: 'ground_beef', name: 'Lean ground beef', unit: '450 g', cat: 'meat', base: 6.99, swap: 'ground_turkey', keywords: 'meat hamburger' },
    { id: 'ground_turkey', name: 'Ground turkey', unit: '450 g', cat: 'meat', base: 5.49, keywords: 'meat' },
    { id: 'tofu', name: 'Firm tofu', unit: '350 g', cat: 'protein', base: 3.29 },
    { id: 'lentils', name: 'Dried lentils', unit: '900 g', cat: 'pantry', base: 3.99, keywords: 'beans' },
    { id: 'black_beans', name: 'Black beans', unit: '540 ml can', cat: 'pantry', base: 1.49, keywords: 'canned' },
    { id: 'tuna', name: 'Canned tuna', unit: '170 g', cat: 'pantry', base: 1.79, keywords: 'fish' },
    { id: 'peanut_butter', name: 'Peanut butter', unit: '1 kg', cat: 'pantry', base: 5.99 },
    { id: 'pasta', name: 'Spaghetti', unit: '900 g', cat: 'pantry', base: 2.49, keywords: 'pasta noodles' },
    { id: 'pasta_sauce', name: 'Pasta sauce', unit: '680 ml', cat: 'pantry', base: 2.99, keywords: 'tomato sauce' },
    { id: 'rice', name: 'White rice', unit: '2 kg', cat: 'pantry', base: 5.99 },
    { id: 'oats', name: 'Large flake oats', unit: '1 kg', cat: 'pantry', base: 4.29, keywords: 'oatmeal' },
    { id: 'cereal', name: 'Name brand cereal', unit: '400 g', cat: 'pantry', base: 5.99, swap: 'store_cereal' },
    { id: 'store_cereal', name: 'Store brand cereal', unit: '400 g', cat: 'pantry', base: 3.49 },
    { id: 'coffee', name: 'Ground coffee', unit: '925 g', cat: 'pantry', base: 12.99, swap: 'store_coffee' },
    { id: 'store_coffee', name: 'Store brand coffee', unit: '925 g', cat: 'pantry', base: 9.49 },
    { id: 'bread', name: 'Whole wheat bread', unit: '675 g', cat: 'bakery', base: 3.49 },
    { id: 'orange_juice', name: 'Orange juice', unit: '1.54 L', cat: 'drinks', base: 4.49, keywords: 'oj' },
  ],

  // This week's flyer deals
  deals: [
    { store: 'foodbasics', product: 'chicken_thighs', price: 7.99 },
    { store: 'nofrills', product: 'ground_beef', price: 4.99 },
    { store: 'nofrills', product: 'apples', price: 2.99 },
    { store: 'freshco', product: 'rice', price: 3.99 },
    { store: 'freshco', product: 'peanut_butter', price: 3.99 },
    { store: 'metro', product: 'coffee', price: 8.99 },
    { store: 'loblaws', product: 'cereal', price: 2.99 },
    { store: 'walmart', product: 'milk', price: 4.79 },
    { store: 'foodbasics', product: 'eggs', price: 3.49 },
    { store: 'market', product: 'tomatoes', price: 1.99 },
  ],

  // Surplus and near expiry offers. kg is used for the food rescued total.
  rescue: [
    { id: 'r1', cat: 'Produce', kg: 1.4, posted: '2 hours ago', store: 'market', name: 'Imperfect produce bag', size: '3 lb', price: 3.00, was: 7.50, note: 'Bruised but great for soups' },
    { id: 'r2', cat: 'Bakery', kg: 1.35, posted: '40 min ago', store: 'nofrills', name: 'Bakery bread', size: '2 loaves', price: 2.50, was: 6.98, note: 'Best before tomorrow' },
    { id: 'r3', cat: 'Meat', kg: 1.0, posted: '1 hour ago', store: 'foodbasics', name: 'Chicken drumsticks', size: '1 kg', price: 5.49, was: 10.99, note: 'Best before Oct 18' },
    { id: 'r4', cat: 'Produce', kg: 0.31, posted: '3 hours ago', store: 'loblaws', name: 'Mixed salad greens', size: '312 g', price: 1.99, was: 4.99, note: 'Best before Oct 17' },
    { id: 'r5', cat: 'Dairy', kg: 0.8, posted: 'This morning', store: 'metro', name: 'Yogurt cups', size: '8 pack', price: 2.99, was: 6.49, note: 'Best before Oct 19' },
    { id: 'r6', cat: 'Produce', kg: 0.9, posted: '25 min ago', store: 'freshco', name: 'Very ripe bananas', size: '2 lb', price: 0.99, was: 1.99, note: 'Perfect for baking' },
    { id: 'r7', cat: 'Prepared', kg: 0.9, posted: '15 min ago', store: 'walmart', name: 'Rotisserie chicken', size: 'whole', price: 6.00, was: 11.97, note: 'Cooked today' },
    { id: 'r8', cat: 'Produce', kg: 0.31, posted: '1 hour ago', store: 'nofrills', name: 'Bagged spinach', size: '312 g', price: 1.79, was: 4.49, note: 'Best before Oct 17' },
  ],

  // Free and low cost food. Names are fictional placeholders for the demo.
  support: [
    { id: 's1', name: 'Eastside Community Food Depot', type: 'Free groceries', offer: 'Grocery hamper with produce, dairy and pantry staples', lat: 42.9870, lng: -81.2170, hours: 'Tue and Thu, 1 to 5pm', serves: 'East London residents', bring: 'Photo ID and proof of address', verified: 'Oct 2, 2026', phone: '519 555 0142' },
    { id: 's2', name: 'Downtown Community Dinner', type: 'Free meal', offer: 'Hot dinner, no sign up needed', lat: 42.9830, lng: -81.2480, hours: 'Daily, 5 to 6:30pm', serves: 'Everyone welcome', bring: 'Nothing needed', verified: 'Oct 10, 2026', phone: '519 555 0178' },
    { id: 's3', name: 'Pay What You Can Produce Market', type: 'Pay what you can', offer: 'Fresh fruit and vegetables from local farms', lat: 42.9900, lng: -81.2290, hours: 'Sat, 9am to 12pm', serves: 'Open to all', bring: 'Your own bags', verified: 'Oct 9, 2026', phone: '519 555 0119' },
    { id: 's4', name: 'Campus Student Food Pantry', type: 'Free groceries', offer: 'Pantry staples and frozen meals', lat: 43.0090, lng: -81.2730, hours: 'Mon to Fri, 11am to 4pm', serves: 'Current students', bring: 'Student card', verified: 'Sep 28, 2026', phone: '519 555 0163' },
    { id: 's5', name: 'South London Family Food Cupboard', type: 'Free groceries', offer: 'Weekly groceries for families, by appointment', lat: 42.9400, lng: -81.2350, hours: 'Wed, 10am to 2pm', serves: 'Families with children under 18', bring: 'Health card for each family member', verified: 'Oct 5, 2026', phone: '519 555 0191' },
    { id: 's6', name: 'North London Community Fridge', type: 'Free food', offer: 'Take what you need, leave what you can', lat: 43.0200, lng: -81.2700, hours: 'Open 24 hours', serves: 'Everyone welcome', bring: 'Nothing needed', verified: 'Oct 12, 2026', phone: '519 555 0155' },
  ],

  // Community groups. kind 'area' groups are tied to a starting area.
  groups: [
    { id: 'g-oldeast', kind: 'area', area: 'oldeast', name: 'Old East Village Deals', members: 412, about: 'Markets, bakeries and bargains around Dundas and the Western Fair.' },
    { id: 'g-downtown', kind: 'area', area: 'downtown', name: 'Downtown Food Finds', members: 638, about: 'Deals, community fridges and free meals in the core.' },
    { id: 'g-masonville', kind: 'area', area: 'masonville', name: 'Masonville and North', members: 287, about: 'Clearance racks and specials in north London.' },
    { id: 'g-campus', kind: 'area', area: 'campus', name: 'Western Campus Eats', members: 1204, about: 'Free food on campus and cheap eats nearby.' },
    { id: 'g-whiteoaks', kind: 'area', area: 'whiteoaks', name: 'White Oaks Savers', members: 196, about: 'South end grocers, bulk stores and specials.' },
    { id: 'g-byron', kind: 'area', area: 'byron', name: 'Byron Neighbours', members: 143, about: 'Farm stands and deals in the west end.' },
    { id: 'g-argyle', kind: 'area', area: 'argyle', name: 'Argyle Deals', members: 178, about: 'East end specials and markdowns.' },
    { id: 'g-students', kind: 'interest', name: 'Student Budget Eats', members: 1530, about: 'Student discounts, free food and cheap meal ideas.' },
    { id: 'g-families', kind: 'interest', name: 'Feeding the Family', members: 524, about: 'Bulk sizes, kids eat free nights and family meal deals.' },
    { id: 'g-halal', kind: 'interest', name: 'Halal Finds London', members: 389, about: 'Where to find affordable halal meat and groceries.' },
    { id: 'g-veg', kind: 'interest', name: 'Plant Based on a Budget', members: 311, about: 'Cheap tofu, beans, produce and vegetarian staples.' },
    { id: 'g-zerowaste', kind: 'interest', name: 'Zero Waste London', members: 452, about: 'Rescued food, bulk refills and bring your own container spots.' },
    { id: 'g-bulk', kind: 'interest', name: 'Bulk Buy Splitters', members: 168, about: 'Team up to split big packs and save together.' },
  ],

  // Demo community posts. People and places are fictional.
  posts: [
    { id: 'p1', group: 'g-oldeast', author: 'Priya S.', minutesAgo: 18, text: 'Mangoes 3 for $2 at the fruit stand outside the Western Fair market. Very ripe, eat them this week.', place: 'Fruit stand, Western Fair', lat: 42.9883, lng: -81.2205, there: 6, gone: 0, comments: [{ author: 'Marcus T.', minutesAgo: 9, text: 'Still there at noon, grabbed some!' }] },
    { id: 'p2', group: 'g-oldeast', author: 'Dan K.', minutesAgo: 52, text: 'Day old bagels, bag of 6 for $1.50 at the bakery on Dundas near Adelaide.', place: 'Dundas St bakery', lat: 42.9868, lng: -81.2365, there: 4, gone: 1, comments: [] },
    { id: 'p3', group: 'g-downtown', author: 'Amira H.', minutesAgo: 120, text: 'Chicken legs $3.99/kg at the butcher on Richmond. Cheaper than any flyer this week.', place: 'Richmond St butcher', lat: 42.9905, lng: -81.2490, there: 9, gone: 0, comments: [{ author: 'Jordan P.', minutesAgo: 40, text: 'Can confirm, they had lots this morning.' }] },
    { id: 'p4', group: 'g-downtown', author: 'Leo M.', minutesAgo: 35, text: 'Community fridge on King St just got restocked with bread and yogurt.', place: 'King St community fridge', lat: 42.9838, lng: -81.2440, there: 3, gone: 0, comments: [] },
    { id: 'p5', group: 'g-masonville', author: 'Jess W.', minutesAgo: 180, text: 'Clearance rack at the back of Loblaws: salad kits $1.99, best before tomorrow.', place: 'Loblaws clearance rack', lat: 43.0270, lng: -81.2820, there: 5, gone: 2, comments: [] },
    { id: 'p6', group: 'g-campus', author: 'Tom R.', minutesAgo: 25, text: 'Free produce table in the student centre atrium until 3pm. Bring a bag!', place: 'Student centre atrium', lat: 43.0080, lng: -81.2750, there: 12, gone: 0, comments: [{ author: 'Sana A.', minutesAgo: 10, text: 'Lots of apples and carrots left.' }] },
    { id: 'p7', group: 'g-whiteoaks', author: 'Grace L.', minutesAgo: 300, text: 'Bulk rice, 10 kg for $14 at the Asian grocer on Wellington.', place: 'Wellington Rd Asian grocer', lat: 42.9420, lng: -81.2290, there: 7, gone: 0, comments: [] },
    { id: 'p8', group: 'g-byron', author: 'Ben O.', minutesAgo: 1440, text: 'Farm stand on Boler Rd: corn 6 for $3, cash only.', place: 'Boler Rd farm stand', lat: 42.9580, lng: -81.3400, there: 4, gone: 1, comments: [] },
    { id: 'p9', group: 'g-argyle', author: 'Nadia F.', minutesAgo: 240, text: 'Dented cans bin near the front, 50 cents each. Beans, tomatoes, soup.', place: 'Argyle Mall grocery', lat: 42.9990, lng: -81.1920, there: 2, gone: 0, comments: [] },
    { id: 'p10', group: 'g-students', author: 'Kevin Z.', minutesAgo: 130, text: 'The bakery on Dundas gives students 10% off on Tuesdays. Just show your card.', place: 'Dundas St bakery', lat: 42.9868, lng: -81.2365, there: 8, gone: 0, comments: [] },
    { id: 'p11', group: 'g-families', author: 'Maria C.', minutesAgo: 360, text: 'Kids eat free on Tuesdays at the diner on Hamilton Rd with any adult meal.', place: 'Hamilton Rd diner', lat: 42.9760, lng: -81.2180, there: 8, gone: 0, comments: [{ author: 'Chris D.', minutesAgo: 200, text: 'We went last week, great deal.' }] },
    { id: 'p12', group: 'g-halal', author: 'Yusuf A.', minutesAgo: 1500, text: 'Zabiha ground beef $5.49/lb at the market on Oxford East.', place: 'Oxford St E market', lat: 42.9950, lng: -81.2200, there: 6, gone: 0, comments: [] },
    { id: 'p13', group: 'g-veg', author: 'Hana K.', minutesAgo: 480, text: 'Firm tofu 2 for $4 and big bags of dried chickpeas for $3.', place: 'Wellington Rd Asian grocer', lat: 42.9420, lng: -81.2290, there: 5, gone: 0, comments: [] },
    { id: 'p14', group: 'g-zerowaste', author: 'Olivia B.', minutesAgo: 1600, text: 'Bring your own container to the bulk store on Richmond Row for 15% off.', place: 'Richmond Row bulk store', lat: 42.9930, lng: -81.2510, there: 9, gone: 0, comments: [] },
    { id: 'p15', group: 'g-bulk', author: 'Sam P.', minutesAgo: 420, text: 'Splitting a 60 pack of eggs this Saturday, 3 spots left. Meet at the warehouse store.', place: 'Wonderland Rd warehouse store', lat: 42.9530, lng: -81.3080, there: 3, gone: 0, comments: [] },
  ],
};
