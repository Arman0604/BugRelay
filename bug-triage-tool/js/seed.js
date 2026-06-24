'use strict';

/**
 * SEED_DATA — 25 pre-loaded bug tickets covering common errors
 * plus GitHub-sourced tickets.
 */
const SEED_DATA = [
  /* ════════════════════════════════════════════════════════════
   * PYTHON ERRORS
   * ════════════════════════════════════════════════════════════ */
  {
    id: 'BUG-001',
    title: 'ZeroDivisionError in payment calculation module',
    description: 'Application crashes with ZeroDivisionError when processing orders with zero quantity. The price_per_unit calculation divides total price by quantity without validating the denominator. Affects checkout flow and causes 500 errors in production.',
    status: 'resolved',
    priority: 'critical',
    language: 'python',
    errorType: 'ZeroDivisionError',
    tags: ['python', 'division', 'math', 'payment', 'crash'],
    codeSnippetBefore: `def calculate_unit_price(total_price, quantity):
    return total_price / quantity   # crashes if quantity == 0

def process_order(order):
    unit_price = calculate_unit_price(order['total'], order['qty'])
    return {'unit_price': unit_price, 'total': order['total']}`,
    codeSnippetAfter: `def calculate_unit_price(total_price, quantity):
    if quantity == 0:
        raise ValueError("Quantity must be greater than zero")
    return total_price / quantity

def process_order(order):
    if order.get('qty', 0) <= 0:
        raise ValueError(f"Invalid quantity: {order.get('qty')}")
    unit_price = calculate_unit_price(order['total'], order['qty'])
    return {'unit_price': unit_price, 'total': order['total']}`,
    codeSnippetDiff: `  def calculate_unit_price(total_price, quantity):
-     return total_price / quantity
+     if quantity == 0:
+         raise ValueError("Quantity must be greater than zero")
+     return total_price / quantity
  
  def process_order(order):
+     if order.get('qty', 0) <= 0:
+         raise ValueError(f"Invalid quantity: {order.get('qty')}")
      unit_price = calculate_unit_price(order['total'], order['qty'])
      return {'unit_price': unit_price, 'total': order['total']}`,
    solution: 'Added explicit guard clause to check if quantity is zero or negative before performing division. Also added validation at the caller site to catch bad input early.',
    source: 'manual',
    createdAt: '2024-01-15T09:23:00Z',
    resolvedAt: '2024-01-15T14:47:00Z',
  },

  {
    id: 'BUG-002',
    title: "ValueError: invalid literal for int() with base 10",
    description: "User input from a web form is passed directly to int() without sanitization. When users enter empty strings, spaces, or non-numeric characters (e.g., '12abc'), a ValueError is raised and the server returns an unhandled 500 error.",
    status: 'resolved',
    priority: 'high',
    language: 'python',
    errorType: 'ValueError',
    tags: ['python', 'type-conversion', 'input-validation', 'int', 'parsing'],
    codeSnippetBefore: `def get_user_age(request):
    age = int(request.POST['age'])   # ValueError if not a valid int
    return {'age': age, 'valid': True}`,
    codeSnippetAfter: `def get_user_age(request):
    raw = request.POST.get('age', '').strip()
    try:
        age = int(raw)
        if age < 0 or age > 150:
            raise ValueError("Age out of realistic range")
        return {'age': age, 'valid': True}
    except ValueError as e:
        return {'error': str(e), 'valid': False}`,
    codeSnippetDiff: `  def get_user_age(request):
-     age = int(request.POST['age'])
-     return {'age': age, 'valid': True}
+     raw = request.POST.get('age', '').strip()
+     try:
+         age = int(raw)
+         if age < 0 or age > 150:
+             raise ValueError("Age out of realistic range")
+         return {'age': age, 'valid': True}
+     except ValueError as e:
+         return {'error': str(e), 'valid': False}`,
    solution: 'Wrapped int() conversion in a try/except block. Added .get() with a default empty string, .strip() to remove whitespace, and a range check for business logic validity.',
    source: 'manual',
    createdAt: '2024-01-20T11:05:00Z',
    resolvedAt: '2024-01-20T13:30:00Z',
  },

  {
    id: 'BUG-003',
    title: 'TypeError: unsupported operand type int + str in data aggregation',
    description: "Data pipeline fails when summing values from a mixed-type list. CSV rows are read as strings by default, and adding a string to an integer raises TypeError. Caused downstream analytics jobs to fail silently.",
    status: 'resolved',
    priority: 'medium',
    language: 'python',
    errorType: 'TypeError',
    tags: ['python', 'type-conversion', 'csv', 'data-pipeline', 'arithmetic'],
    codeSnippetBefore: `import csv

def sum_sales(filename):
    total = 0
    with open(filename) as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += row['amount']   # TypeError: int + str
    return total`,
    codeSnippetAfter: `import csv

def sum_sales(filename):
    total = 0.0
    with open(filename) as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                total += float(row['amount'])
            except (ValueError, TypeError) as e:
                print(f"Skipping invalid row: {row} — {e}")
    return total`,
    codeSnippetDiff: `  def sum_sales(filename):
-     total = 0
+     total = 0.0
      with open(filename) as f:
          reader = csv.DictReader(f)
          for row in reader:
-             total += row['amount']
+             try:
+                 total += float(row['amount'])
+             except (ValueError, TypeError) as e:
+                 print(f"Skipping invalid row: {row} — {e}")
      return total`,
    solution: 'Cast each CSV value to float() within a try/except. Changed total to float to support decimal amounts. Bad rows are now logged and skipped rather than crashing the entire job.',
    source: 'manual',
    createdAt: '2024-02-01T08:45:00Z',
    resolvedAt: '2024-02-01T10:20:00Z',
  },

  {
    id: 'BUG-004',
    title: 'FileNotFoundError when loading configuration file at startup',
    description: 'Application raises FileNotFoundError during initialization when the config.yaml file is missing or the working directory is not set correctly. This prevents the service from starting in containerized environments where the config is mounted at a different path.',
    status: 'open',
    priority: 'medium',
    language: 'python',
    errorType: 'FileNotFoundError',
    tags: ['python', 'file-io', 'config', 'startup', 'docker', 'path'],
    codeSnippetBefore: `import yaml

def load_config():
    with open('config.yaml', 'r') as f:   # FileNotFoundError
        return yaml.safe_load(f)

config = load_config()`,
    codeSnippetAfter: `import yaml
import os

CONFIG_PATHS = [
    'config.yaml',
    '/etc/app/config.yaml',
    os.path.join(os.path.dirname(__file__), 'config.yaml'),
]

def load_config():
    for path in CONFIG_PATHS:
        if os.path.exists(path):
            with open(path, 'r') as f:
                return yaml.safe_load(f)
    raise FileNotFoundError(
        f"Config file not found. Searched: {CONFIG_PATHS}"
    )

config = load_config()`,
    codeSnippetDiff: `  import yaml
+ import os
+ 
+ CONFIG_PATHS = [
+     'config.yaml',
+     '/etc/app/config.yaml',
+     os.path.join(os.path.dirname(__file__), 'config.yaml'),
+ ]
  
  def load_config():
-     with open('config.yaml', 'r') as f:
-         return yaml.safe_load(f)
+     for path in CONFIG_PATHS:
+         if os.path.exists(path):
+             with open(path, 'r') as f:
+                 return yaml.safe_load(f)
+     raise FileNotFoundError(
+         f"Config file not found. Searched: {CONFIG_PATHS}"
+     )`,
    solution: 'Implement a path search list with multiple fallback locations. Use os.path.exists() to probe each candidate before opening.',
    source: 'manual',
    createdAt: '2024-02-10T14:00:00Z',
    resolvedAt: null,
  },

  {
    id: 'BUG-005',
    title: 'KeyError: missing key in user session dictionary',
    description: 'KeyError raised when accessing session["user_id"] on requests that have not yet authenticated. The session dict exists but does not contain the expected key, crashing the middleware on every unauthenticated request.',
    status: 'resolved',
    priority: 'high',
    language: 'python',
    errorType: 'KeyError',
    tags: ['python', 'dictionary', 'session', 'authentication', 'middleware'],
    codeSnippetBefore: `def auth_middleware(request):
    user_id = request.session['user_id']   # KeyError if not logged in
    user = User.objects.get(id=user_id)
    request.user = user`,
    codeSnippetAfter: `def auth_middleware(request):
    user_id = request.session.get('user_id')
    if user_id is None:
        request.user = AnonymousUser()
        return
    try:
        request.user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        request.session.flush()
        request.user = AnonymousUser()`,
    codeSnippetDiff: `  def auth_middleware(request):
-     user_id = request.session['user_id']
-     user = User.objects.get(id=user_id)
-     request.user = user
+     user_id = request.session.get('user_id')
+     if user_id is None:
+         request.user = AnonymousUser()
+         return
+     try:
+         request.user = User.objects.get(id=user_id)
+     except User.DoesNotExist:
+         request.session.flush()
+         request.user = AnonymousUser()`,
    solution: 'Use dict.get() instead of bracket notation to avoid KeyError. Handle both missing key and stale user ID cases explicitly.',
    source: 'manual',
    createdAt: '2024-02-14T09:00:00Z',
    resolvedAt: '2024-02-14T11:30:00Z',
  },

  {
    id: 'BUG-006',
    title: 'AttributeError: NoneType object has no attribute split',
    description: "Function calls .split() on a value that can be None when the database returns a NULL for an optional field. The error surfaced in production after a data migration that set certain description fields to NULL.",
    status: 'resolved',
    priority: 'high',
    language: 'python',
    errorType: 'AttributeError',
    tags: ['python', 'null', 'none', 'attribute-error', 'string', 'database'],
    codeSnippetBefore: `def get_tags(product):
    # description can be NULL from DB
    return product.description.split(',')   # AttributeError: NoneType`,
    codeSnippetAfter: `def get_tags(product):
    description = product.description or ''
    if not description.strip():
        return []
    return [tag.strip() for tag in description.split(',') if tag.strip()]`,
    codeSnippetDiff: `  def get_tags(product):
-     return product.description.split(',')
+     description = product.description or ''
+     if not description.strip():
+         return []
+     return [tag.strip() for tag in description.split(',') if tag.strip()]`,
    solution: 'Guard against None using "or \'\'" pattern before string operations. Also added strip() to clean whitespace from individual tags.',
    source: 'manual',
    createdAt: '2024-02-22T13:15:00Z',
    resolvedAt: '2024-02-22T14:45:00Z',
  },

  {
    id: 'BUG-007',
    title: 'RecursionError: maximum recursion depth exceeded in tree traversal',
    description: 'Deep or cyclic tree structures cause the recursive DFS traversal to exceed Python\'s default recursion limit (1000). Occurs when processing deeply nested JSON configs with more than 1000 levels, or when a circular reference exists.',
    status: 'resolved',
    priority: 'medium',
    language: 'python',
    errorType: 'RecursionError',
    tags: ['python', 'recursion', 'tree', 'dfs', 'stack-overflow', 'depth-limit'],
    codeSnippetBefore: `def traverse(node):
    result = [node['value']]
    for child in node.get('children', []):
        result.extend(traverse(child))   # RecursionError on deep trees
    return result`,
    codeSnippetAfter: `def traverse(node, max_depth=500):
    result = []
    stack = [(node, 0)]
    visited = set()
    while stack:
        current, depth = stack.pop()
        node_id = id(current)
        if node_id in visited or depth > max_depth:
            continue
        visited.add(node_id)
        result.append(current['value'])
        for child in reversed(current.get('children', [])):
            stack.append((child, depth + 1))
    return result`,
    codeSnippetDiff: `- def traverse(node):
-     result = [node['value']]
-     for child in node.get('children', []):
-         result.extend(traverse(child))
-     return result
+ def traverse(node, max_depth=500):
+     result = []
+     stack = [(node, 0)]
+     visited = set()
+     while stack:
+         current, depth = stack.pop()
+         node_id = id(current)
+         if node_id in visited or depth > max_depth:
+             continue
+         visited.add(node_id)
+         result.append(current['value'])
+         for child in reversed(current.get('children', [])):
+             stack.append((child, depth + 1))
+     return result`,
    solution: 'Converted recursive DFS to iterative using an explicit stack. Added cycle detection via a visited set and a configurable max_depth guard.',
    source: 'manual',
    createdAt: '2024-03-05T10:00:00Z',
    resolvedAt: '2024-03-05T12:00:00Z',
  },

  {
    id: 'BUG-008',
    title: 'UnicodeDecodeError: utf-8 codec cannot decode byte in log file',
    description: "Reading log files fails when the file contains non-UTF-8 bytes (e.g., from legacy Windows systems using CP1252 or latin-1 encoding). The default open() call uses UTF-8 and raises UnicodeDecodeError on the first problematic byte.",
    status: 'resolved',
    priority: 'low',
    language: 'python',
    errorType: 'UnicodeDecodeError',
    tags: ['python', 'unicode', 'encoding', 'file-io', 'utf-8', 'charset'],
    codeSnippetBefore: `def read_log(path):
    with open(path, 'r') as f:   # UnicodeDecodeError on non-UTF-8 files
        return f.readlines()`,
    codeSnippetAfter: `def read_log(path):
    encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']
    for enc in encodings:
        try:
            with open(path, 'r', encoding=enc, errors='strict') as f:
                return f.readlines()
        except (UnicodeDecodeError, LookupError):
            continue
    # Last resort: replace undecodable bytes
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        return f.readlines()`,
    codeSnippetDiff: `  def read_log(path):
-     with open(path, 'r') as f:
-         return f.readlines()
+     encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']
+     for enc in encodings:
+         try:
+             with open(path, 'r', encoding=enc, errors='strict') as f:
+                 return f.readlines()
+         except (UnicodeDecodeError, LookupError):
+             continue
+     with open(path, 'r', encoding='utf-8', errors='replace') as f:
+         return f.readlines()`,
    solution: 'Try multiple encodings in order. Fall back to UTF-8 with errors=replace as last resort to ensure data is always readable.',
    source: 'manual',
    createdAt: '2024-03-12T15:30:00Z',
    resolvedAt: '2024-03-12T16:20:00Z',
  },

  /* ════════════════════════════════════════════════════════════
   * JAVASCRIPT ERRORS
   * ════════════════════════════════════════════════════════════ */
  {
    id: 'BUG-009',
    title: "TypeError: Cannot read property 'length' of null",
    description: "A DOM element queried with getElementById returns null when the element does not exist in the page (e.g., on a different route). Calling .length on null crashes the entire script and breaks subsequent page functionality.",
    status: 'resolved',
    priority: 'high',
    language: 'javascript',
    errorType: 'TypeError',
    tags: ['javascript', 'dom', 'null', 'null-check', 'browser'],
    codeSnippetBefore: `function getItemCount() {
  const list = document.getElementById('item-list');
  return list.children.length;   // TypeError if element doesn't exist
}`,
    codeSnippetAfter: `function getItemCount() {
  const list = document.getElementById('item-list');
  if (!list) {
    console.warn('Element #item-list not found in DOM');
    return 0;
  }
  return list.children.length;
}`,
    codeSnippetDiff: `  function getItemCount() {
    const list = document.getElementById('item-list');
+   if (!list) {
+     console.warn('Element #item-list not found in DOM');
+     return 0;
+   }
    return list.children.length;
  }`,
    solution: 'Added null guard before accessing DOM element properties. Return a safe default value when element is not present.',
    source: 'manual',
    createdAt: '2024-01-18T10:00:00Z',
    resolvedAt: '2024-01-18T10:45:00Z',
  },

  {
    id: 'BUG-010',
    title: 'Unhandled Promise Rejection in async fetch call',
    description: 'API call using fetch() does not have a .catch() handler. Network errors or non-2xx responses cause UnhandledPromiseRejection warnings in Node.js 15+ (which terminate the process) and silent failures in browsers. Affected the dashboard data loading on poor connections.',
    status: 'open',
    priority: 'high',
    language: 'javascript',
    errorType: 'UnhandledPromiseRejection',
    tags: ['javascript', 'promise', 'async', 'fetch', 'error-handling', 'network'],
    codeSnippetBefore: `async function loadDashboard() {
  const response = await fetch('/api/dashboard');
  const data = await response.json();   // throws if response is 4xx/5xx
  renderDashboard(data);
}

loadDashboard();   // no catch handler`,
    codeSnippetAfter: `async function loadDashboard() {
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
    }
    const data = await response.json();
    renderDashboard(data);
  } catch (error) {
    console.error('Dashboard load failed:', error);
    renderError('Failed to load dashboard. Please try again.');
  }
}

loadDashboard().catch(console.error);`,
    codeSnippetDiff: `  async function loadDashboard() {
+   try {
      const response = await fetch('/api/dashboard');
-     const data = await response.json();
+     if (!response.ok) {
+       throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
+     }
+     const data = await response.json();
      renderDashboard(data);
+   } catch (error) {
+     console.error('Dashboard load failed:', error);
+     renderError('Failed to load dashboard. Please try again.');
+   }
  }
- loadDashboard();
+ loadDashboard().catch(console.error);`,
    solution: 'Wrap async call in try/catch. Check response.ok before parsing JSON. Render a user-friendly error message on failure.',
    source: 'manual',
    createdAt: '2024-01-25T14:20:00Z',
    resolvedAt: null,
  },

  {
    id: 'BUG-011',
    title: 'CORS error blocking cross-origin API requests in production',
    description: "Browser blocks API requests to a different origin with 'Access-Control-Allow-Origin' header missing. Worked in development (same origin) but broke in production where frontend and backend are on different subdomains.",
    status: 'open',
    priority: 'medium',
    language: 'javascript',
    errorType: 'CORSError',
    tags: ['javascript', 'cors', 'http', 'fetch', 'browser', 'security', 'api'],
    codeSnippetBefore: `// Express backend — no CORS headers
app.get('/api/data', (req, res) => {
  res.json({ data: 'some data' });
});

// Frontend fetch
fetch('https://api.example.com/api/data')
  .then(r => r.json())   // CORS error in browser console`,
    codeSnippetAfter: `// Express backend — add cors middleware
const cors = require('cors');
app.use(cors({
  origin: ['https://app.example.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.get('/api/data', (req, res) => {
  res.json({ data: 'some data' });
});`,
    codeSnippetDiff: `+ const cors = require('cors');
+ app.use(cors({
+   origin: ['https://app.example.com', 'http://localhost:3000'],
+   methods: ['GET', 'POST', 'PUT', 'DELETE'],
+   credentials: true,
+ }));
+ 
  app.get('/api/data', (req, res) => {
    res.json({ data: 'some data' });
  });`,
    solution: 'Install and configure the cors npm package on the Express server with explicit allowed origins. Do not use wildcard (*) if credentials are required.',
    source: 'manual',
    createdAt: '2024-02-05T11:00:00Z',
    resolvedAt: null,
  },

  {
    id: 'BUG-012',
    title: 'React: setState called on unmounted component causing memory leak',
    description: 'Warning: "Can\'t perform a React state update on an unmounted component." Async data fetch completes after component is unmounted (e.g., user navigated away), then tries to call setState on the dead component, causing memory leak.',
    status: 'resolved',
    priority: 'medium',
    language: 'javascript',
    errorType: 'MemoryLeak',
    tags: ['javascript', 'react', 'state', 'unmounted', 'memory-leak', 'async', 'useEffect'],
    codeSnippetBefore: `useEffect(() => {
  fetch('/api/user')
    .then(r => r.json())
    .then(data => setUser(data));   // memory leak: runs after unmount
}, []);`,
    codeSnippetAfter: `useEffect(() => {
  let isMounted = true;
  const controller = new AbortController();
  
  fetch('/api/user', { signal: controller.signal })
    .then(r => r.json())
    .then(data => {
      if (isMounted) setUser(data);
    })
    .catch(err => {
      if (err.name !== 'AbortError') console.error(err);
    });
  
  return () => {
    isMounted = false;
    controller.abort();
  };
}, []);`,
    codeSnippetDiff: `  useEffect(() => {
+   let isMounted = true;
+   const controller = new AbortController();
+ 
-   fetch('/api/user')
+   fetch('/api/user', { signal: controller.signal })
      .then(r => r.json())
-     .then(data => setUser(data));
+     .then(data => {
+       if (isMounted) setUser(data);
+     })
+     .catch(err => {
+       if (err.name !== 'AbortError') console.error(err);
+     });
+ 
+   return () => {
+     isMounted = false;
+     controller.abort();
+   };
  }, []);`,
    solution: 'Use an isMounted flag and AbortController for cleanup. Return a cleanup function from useEffect to cancel in-flight requests when the component unmounts.',
    source: 'manual',
    createdAt: '2024-02-28T09:45:00Z',
    resolvedAt: '2024-02-28T11:00:00Z',
  },

  /* ════════════════════════════════════════════════════════════
   * JAVA ERRORS
   * ════════════════════════════════════════════════════════════ */
  {
    id: 'BUG-013',
    title: 'NullPointerException in user authentication service',
    description: 'java.lang.NullPointerException thrown when getUser() returns null for an invalid session token. The caller does not check the return value before calling methods on it, crashing the authentication filter and logging out all active sessions.',
    status: 'resolved',
    priority: 'critical',
    language: 'java',
    errorType: 'NullPointerException',
    tags: ['java', 'null-pointer', 'null-check', 'authentication', 'session', 'critical'],
    codeSnippetBefore: `public boolean isAuthorized(String token) {
    User user = userRepository.findByToken(token);
    return user.getRoles().contains("ADMIN");  // NPE if user is null
}`,
    codeSnippetAfter: `public boolean isAuthorized(String token) {
    if (token == null || token.isEmpty()) {
        return false;
    }
    User user = userRepository.findByToken(token);
    if (user == null) {
        log.warn("No user found for token: {}", maskToken(token));
        return false;
    }
    return user.getRoles() != null && user.getRoles().contains("ADMIN");
}`,
    codeSnippetDiff: `  public boolean isAuthorized(String token) {
+     if (token == null || token.isEmpty()) {
+         return false;
+     }
      User user = userRepository.findByToken(token);
-     return user.getRoles().contains("ADMIN");
+     if (user == null) {
+         log.warn("No user found for token: {}", maskToken(token));
+         return false;
+     }
+     return user.getRoles() != null && user.getRoles().contains("ADMIN");
  }`,
    solution: 'Added null checks for both the token input and the returned user object. Added logging for the failure case. Use Optional<User> as a better long-term fix.',
    source: 'manual',
    createdAt: '2024-01-10T08:30:00Z',
    resolvedAt: '2024-01-10T09:15:00Z',
  },

  {
    id: 'BUG-014',
    title: 'ArrayIndexOutOfBoundsException in batch data processor',
    description: 'java.lang.ArrayIndexOutOfBoundsException: Index 10 out of bounds for length 10. Off-by-one error in a loop that processes batches of records. The loop uses <= instead of < when comparing with array.length.',
    status: 'resolved',
    priority: 'high',
    language: 'java',
    errorType: 'ArrayIndexOutOfBoundsException',
    tags: ['java', 'array', 'index-out-of-bounds', 'off-by-one', 'loop', 'batch'],
    codeSnippetBefore: `public void processBatch(String[] records) {
    for (int i = 0; i <= records.length; i++) {   // AIOOBE at last iteration
        processRecord(records[i]);
    }
}`,
    codeSnippetAfter: `public void processBatch(String[] records) {
    if (records == null || records.length == 0) {
        log.info("Empty batch, nothing to process");
        return;
    }
    for (int i = 0; i < records.length; i++) {   // use strict less-than
        try {
            processRecord(records[i]);
        } catch (Exception e) {
            log.error("Failed to process record at index {}: {}", i, e.getMessage());
        }
    }
}`,
    codeSnippetDiff: `  public void processBatch(String[] records) {
+     if (records == null || records.length == 0) {
+         log.info("Empty batch, nothing to process");
+         return;
+     }
-     for (int i = 0; i <= records.length; i++) {
+     for (int i = 0; i < records.length; i++) {
-         processRecord(records[i]);
+         try {
+             processRecord(records[i]);
+         } catch (Exception e) {
+             log.error("Failed at index {}: {}", i, e.getMessage());
+         }
      }
  }`,
    solution: 'Fixed off-by-one: changed <= to < in loop condition. Added null/empty check at start. Wrapped individual record processing in try/catch to prevent one bad record from failing the entire batch.',
    source: 'manual',
    createdAt: '2024-02-08T13:00:00Z',
    resolvedAt: '2024-02-08T13:40:00Z',
  },

  {
    id: 'BUG-015',
    title: 'StackOverflowError in recursive Fibonacci implementation',
    description: 'java.lang.StackOverflowError when computing Fibonacci for large inputs (n > 10000). The naive recursive implementation creates an exponential call tree that exhausts the JVM stack. Function is called in a hot path during report generation.',
    status: 'resolved',
    priority: 'high',
    language: 'java',
    errorType: 'StackOverflowError',
    tags: ['java', 'recursion', 'stack-overflow', 'fibonacci', 'performance', 'memoization'],
    codeSnippetBefore: `public long fibonacci(int n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);  // StackOverflowError for large n
}`,
    codeSnippetAfter: `private final Map<Integer, Long> memo = new HashMap<>();

public long fibonacci(int n) {
    if (n < 0) throw new IllegalArgumentException("n must be non-negative");
    if (n <= 1) return n;
    if (memo.containsKey(n)) return memo.get(n);
    
    // Iterative approach to avoid stack overflow
    long a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        long temp = a + b;
        a = b;
        b = temp;
    }
    memo.put(n, b);
    return b;
}`,
    codeSnippetDiff: `+ private final Map<Integer, Long> memo = new HashMap<>();
+ 
  public long fibonacci(int n) {
+     if (n < 0) throw new IllegalArgumentException("n must be non-negative");
      if (n <= 1) return n;
-     return fibonacci(n - 1) + fibonacci(n - 2);
+     if (memo.containsKey(n)) return memo.get(n);
+     long a = 0, b = 1;
+     for (int i = 2; i <= n; i++) {
+         long temp = a + b; a = b; b = temp;
+     }
+     memo.put(n, b);
+     return b;
  }`,
    solution: 'Replaced exponential recursion with iterative bottom-up computation. Added memoization cache for frequently requested values. Added input validation.',
    source: 'manual',
    createdAt: '2024-03-01T14:30:00Z',
    resolvedAt: '2024-03-01T15:30:00Z',
  },

  {
    id: 'BUG-016',
    title: 'Integer overflow in reward points accumulation',
    description: 'Customer reward points silently overflow when accumulated points exceed Integer.MAX_VALUE (2,147,483,647). High-volume users see their points wrap around to a large negative number. The field is stored as int in both Java and the database schema.',
    status: 'resolved',
    priority: 'critical',
    language: 'java',
    errorType: 'IntegerOverflow',
    tags: ['java', 'integer-overflow', 'arithmetic', 'long', 'data-type', 'rewards'],
    codeSnippetBefore: `public class RewardAccount {
    private int totalPoints;   // int: max 2,147,483,647

    public void addPoints(int points) {
        this.totalPoints += points;   // silent overflow!
    }
}`,
    codeSnippetAfter: `public class RewardAccount {
    private long totalPoints;   // long: max 9.2 × 10^18

    public void addPoints(long points) {
        if (points < 0) throw new IllegalArgumentException("Points cannot be negative");
        long newTotal = this.totalPoints + points;
        if (newTotal < this.totalPoints) {
            throw new ArithmeticException("Points overflow detected");
        }
        this.totalPoints = newTotal;
    }

    public long getTotalPoints() { return totalPoints; }
}`,
    codeSnippetDiff: `  public class RewardAccount {
-     private int totalPoints;
+     private long totalPoints;
  
-     public void addPoints(int points) {
-         this.totalPoints += points;
+     public void addPoints(long points) {
+         if (points < 0) throw new IllegalArgumentException("Points cannot be negative");
+         long newTotal = this.totalPoints + points;
+         if (newTotal < this.totalPoints) {
+             throw new ArithmeticException("Points overflow detected");
+         }
+         this.totalPoints = newTotal;
      }
  }`,
    solution: 'Changed data type from int to long. Added overflow detection via comparison after addition. Updated DB schema column from INT to BIGINT.',
    source: 'manual',
    createdAt: '2024-03-15T10:00:00Z',
    resolvedAt: '2024-03-20T16:00:00Z',
  },

  /* ════════════════════════════════════════════════════════════
   * C / C++ ERRORS
   * ════════════════════════════════════════════════════════════ */
  {
    id: 'BUG-017',
    title: 'Memory leak in database connection pool',
    description: 'Connections are allocated from the pool but never returned when an exception is thrown mid-transaction. Over 48 hours, all pool slots are exhausted and new requests hang indefinitely waiting for an available connection.',
    status: 'open',
    priority: 'critical',
    language: 'cpp',
    errorType: 'MemoryLeak',
    tags: ['cpp', 'memory-leak', 'connection-pool', 'raii', 'exception', 'database'],
    codeSnippetBefore: `Connection* conn = pool.acquire();
executeQuery(conn, query);           // throws on DB error
pool.release(conn);                  // never reached if exception thrown`,
    codeSnippetAfter: `// RAII wrapper ensures release even if exception thrown
class ScopedConnection {
    ConnectionPool& pool;
    Connection* conn;
public:
    ScopedConnection(ConnectionPool& p) : pool(p), conn(p.acquire()) {}
    ~ScopedConnection() { if (conn) pool.release(conn); }
    Connection* get() { return conn; }
};

ScopedConnection sc(pool);
executeQuery(sc.get(), query);   // conn auto-released when sc goes out of scope`,
    codeSnippetDiff: `- Connection* conn = pool.acquire();
- executeQuery(conn, query);
- pool.release(conn);
+ class ScopedConnection {
+     ConnectionPool& pool; Connection* conn;
+ public:
+     ScopedConnection(ConnectionPool& p) : pool(p), conn(p.acquire()) {}
+     ~ScopedConnection() { if (conn) pool.release(conn); }
+     Connection* get() { return conn; }
+ };
+ ScopedConnection sc(pool);
+ executeQuery(sc.get(), query);`,
    solution: 'Apply RAII pattern: wrap connection acquisition in a stack-allocated object whose destructor returns the connection. This guarantees cleanup even when exceptions are thrown.',
    source: 'manual',
    createdAt: '2024-03-20T08:00:00Z',
    resolvedAt: null,
  },

  /* ════════════════════════════════════════════════════════════
   * SQL / DATABASE ERRORS
   * ════════════════════════════════════════════════════════════ */
  {
    id: 'BUG-018',
    title: 'SQL Injection vulnerability via unsanitized user input',
    description: 'User-supplied search term is concatenated directly into a SQL query string. Attacker can inject SQL to bypass authentication, exfiltrate data, or drop tables. Found via security audit in the product search endpoint.',
    status: 'resolved',
    priority: 'critical',
    language: 'php',
    errorType: 'SQLInjection',
    tags: ['php', 'sql-injection', 'security', 'vulnerability', 'parameterized-query'],
    codeSnippetBefore: `$search = $_GET['q'];
$sql = "SELECT * FROM products WHERE name LIKE '%$search%'";
$result = mysqli_query($conn, $sql);   // SQL injection vulnerability`,
    codeSnippetAfter: `$search = $_GET['q'] ?? '';
$stmt = $conn->prepare("SELECT * FROM products WHERE name LIKE ?");
$like = '%' . $conn->real_escape_string($search) . '%';
$stmt->bind_param("s", $like);
$stmt->execute();
$result = $stmt->get_result();`,
    codeSnippetDiff: `- $search = $_GET['q'];
- $sql = "SELECT * FROM products WHERE name LIKE '%$search%'";
- $result = mysqli_query($conn, $sql);
+ $search = $_GET['q'] ?? '';
+ $stmt = $conn->prepare("SELECT * FROM products WHERE name LIKE ?");
+ $like = '%' . $conn->real_escape_string($search) . '%';
+ $stmt->bind_param("s", $like);
+ $stmt->execute();
+ $result = $stmt->get_result();`,
    solution: 'Replaced string concatenation with parameterized prepared statement. Never interpolate user input into SQL. Use PDO or mysqli prepared statements.',
    source: 'manual',
    createdAt: '2024-01-05T09:00:00Z',
    resolvedAt: '2024-01-05T10:30:00Z',
  },

  /* ════════════════════════════════════════════════════════════
   * GITHUB-SOURCED TICKETS
   * ════════════════════════════════════════════════════════════ */
  {
    id: 'BUG-019',
    title: '[cpython] statistics.mean() raises ZeroDivisionError on empty sequence',
    description: 'statistics.mean([]) raises ZeroDivisionError instead of a more informative StatisticsError. The fix is to validate the input sequence is non-empty before computing the mean and raise a descriptive error message. Reported in CPython issue tracker.',
    status: 'resolved',
    priority: 'medium',
    language: 'python',
    errorType: 'ZeroDivisionError',
    tags: ['python', 'stdlib', 'statistics', 'mean', 'empty-sequence', 'cpython'],
    codeSnippetBefore: `def mean(data):
    T, total, count = _sum(data)
    if count < 1:
        raise StatisticsError('mean requires at least one data point')
    return _convert(total/count, T)   # ZeroDivisionError if count==0`,
    codeSnippetAfter: `def mean(data):
    if iter(data) is data:
        data = list(data)
    n = len(data)
    if n < 1:
        raise StatisticsError('mean requires at least one data point')
    T, total, count = _sum(data)
    assert count == n
    return _convert(total / count, T)`,
    codeSnippetDiff: `  def mean(data):
+     if iter(data) is data:
+         data = list(data)
+     n = len(data)
+     if n < 1:
+         raise StatisticsError('mean requires at least one data point')
      T, total, count = _sum(data)
-     if count < 1:
-         raise StatisticsError('mean requires at least one data point')
+     assert count == n
      return _convert(total/count, T)`,
    solution: 'Validate input length before calling _sum. Raise StatisticsError with a descriptive message early.',
    source: 'github',
    sourceUrl: 'https://github.com/python/cpython/issues/74232',
    createdAt: '2023-11-10T12:00:00Z',
    resolvedAt: '2023-11-15T09:00:00Z',
  },

  {
    id: 'BUG-020',
    title: '[nodejs] Unhandled rejection in stream pipeline causes process exit',
    description: 'When using stream.pipeline() in async mode without proper error handling, a rejection in any stage can bring down the Node.js process in versions >= 15. Fixed by ensuring the async callback always handles errors.',
    status: 'resolved',
    priority: 'high',
    language: 'javascript',
    errorType: 'UnhandledPromiseRejection',
    tags: ['nodejs', 'stream', 'pipeline', 'promise', 'rejection', 'async'],
    codeSnippetBefore: `const { pipeline } = require('stream/promises');

async function processFile(input, output) {
  await pipeline(input, transform, output);
  // If transform throws, rejection propagates and kills process
}`,
    codeSnippetAfter: `const { pipeline } = require('stream/promises');

async function processFile(input, output) {
  try {
    await pipeline(input, transform, output);
  } catch (err) {
    console.error('Pipeline failed:', err);
    // Ensure streams are destroyed
    input.destroy(err);
    output.destroy(err);
    throw err;
  }
}`,
    codeSnippetDiff: `  async function processFile(input, output) {
-   await pipeline(input, transform, output);
+   try {
+     await pipeline(input, transform, output);
+   } catch (err) {
+     console.error('Pipeline failed:', err);
+     input.destroy(err);
+     output.destroy(err);
+     throw err;
+   }
  }`,
    solution: 'Wrap pipeline in try/catch. Explicitly destroy source and destination streams on error to prevent resource leaks.',
    source: 'github',
    sourceUrl: 'https://github.com/nodejs/node/issues/38314',
    createdAt: '2023-12-01T10:00:00Z',
    resolvedAt: '2023-12-05T14:00:00Z',
  },

  {
    id: 'BUG-021',
    title: '[vscode] Extension crashes with TypeError on workspace folder access',
    description: 'vscode.workspace.workspaceFolders returns undefined when no folder is open. Extension code accesses [0] without null check, throwing TypeError and disabling extension functionality for users without an open workspace.',
    status: 'resolved',
    priority: 'high',
    language: 'javascript',
    errorType: 'TypeError',
    tags: ['vscode', 'extension', 'typescript', 'workspace', 'null-check', 'undefined'],
    codeSnippetBefore: `function getWorkspaceRoot() {
  // TypeError if no workspace open
  return vscode.workspace.workspaceFolders[0].uri.fsPath;
}`,
    codeSnippetAfter: `function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('Please open a workspace folder first.');
    return undefined;
  }
  return folders[0].uri.fsPath;
}`,
    codeSnippetDiff: `- function getWorkspaceRoot() {
-   return vscode.workspace.workspaceFolders[0].uri.fsPath;
+ function getWorkspaceRoot(): string | undefined {
+   const folders = vscode.workspace.workspaceFolders;
+   if (!folders || folders.length === 0) {
+     vscode.window.showWarningMessage('Please open a workspace folder first.');
+     return undefined;
+   }
+   return folders[0].uri.fsPath;
  }`,
    solution: 'Guard against undefined workspaceFolders. Return undefined and show a user-friendly message when no workspace is open.',
    source: 'github',
    sourceUrl: 'https://github.com/microsoft/vscode/issues/134567',
    createdAt: '2024-01-02T11:00:00Z',
    resolvedAt: '2024-01-03T09:00:00Z',
  },

  {
    id: 'BUG-022',
    title: 'OutOfMemoryError: Java heap space in report generation',
    description: 'Generating reports for large date ranges loads all records into memory at once. For date ranges > 90 days with high transaction volume (millions of rows), the JVM runs out of heap space and crashes the service.',
    status: 'open',
    priority: 'critical',
    language: 'java',
    errorType: 'OutOfMemoryError',
    tags: ['java', 'memory', 'heap', 'oom', 'pagination', 'streaming', 'report'],
    codeSnippetBefore: `public List<Transaction> getReport(Date start, Date end) {
    // Loads ALL records into memory — OOM for large ranges
    return transactionRepo.findByDateBetween(start, end);
}`,
    codeSnippetAfter: `public void streamReport(Date start, Date end, OutputStream out) {
    int page = 0;
    final int PAGE_SIZE = 1000;
    Page<Transaction> batch;
    
    try (CSVWriter writer = new CSVWriter(new OutputStreamWriter(out))) {
        do {
            Pageable pageable = PageRequest.of(page++, PAGE_SIZE);
            batch = transactionRepo.findByDateBetween(start, end, pageable);
            batch.forEach(t -> writer.writeNext(t.toCsvRow()));
        } while (batch.hasNext());
    }
}`,
    codeSnippetDiff: `- public List<Transaction> getReport(Date start, Date end) {
-     return transactionRepo.findByDateBetween(start, end);
+ public void streamReport(Date start, Date end, OutputStream out) {
+     int page = 0; final int PAGE_SIZE = 1000;
+     Page<Transaction> batch;
+     try (CSVWriter writer = ...) {
+         do {
+             Pageable p = PageRequest.of(page++, PAGE_SIZE);
+             batch = transactionRepo.findByDateBetween(start, end, p);
+             batch.forEach(t -> writer.writeNext(t.toCsvRow()));
+         } while (batch.hasNext());
+     }
  }`,
    solution: 'Replace in-memory loading with paginated streaming. Process records in chunks of 1000, write directly to output stream. Use Spring Data Pageable.',
    source: 'manual',
    createdAt: '2024-03-25T07:00:00Z',
    resolvedAt: null,
  },

  {
    id: 'BUG-023',
    title: 'Deadlock in multithreaded transaction processing',
    description: 'Two threads acquire locks on Account A and Account B in opposite order, causing a classic deadlock. Thread 1 holds lock on A and waits for B; Thread 2 holds lock on B and waits for A. Both threads block indefinitely.',
    status: 'resolved',
    priority: 'critical',
    language: 'java',
    errorType: 'Deadlock',
    tags: ['java', 'deadlock', 'thread', 'lock', 'concurrency', 'transaction', 'synchronization'],
    codeSnippetBefore: `// Thread 1: transfer(A, B, amount)
synchronized(accountA) {
    synchronized(accountB) {   // Deadlock if Thread 2 has lock on B
        accountA.debit(amount);
        accountB.credit(amount);
    }
}`,
    codeSnippetAfter: `// Enforce consistent lock ordering by account ID
public void transfer(Account from, Account to, BigDecimal amount) {
    Account first  = from.getId() < to.getId() ? from : to;
    Account second = from.getId() < to.getId() ? to   : from;
    
    synchronized(first) {
        synchronized(second) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}`,
    codeSnippetDiff: `- synchronized(accountA) {
-     synchronized(accountB) {
-         accountA.debit(amount); accountB.credit(amount);
-     }
- }
+ Account first  = from.getId() < to.getId() ? from : to;
+ Account second = from.getId() < to.getId() ? to   : from;
+ synchronized(first) {
+     synchronized(second) {
+         from.debit(amount); to.credit(amount);
+     }
+ }`,
    solution: 'Enforce a global lock ordering by always acquiring locks in ascending account ID order. Both threads now lock in the same order, eliminating deadlock.',
    source: 'manual',
    createdAt: '2024-02-18T16:00:00Z',
    resolvedAt: '2024-02-19T10:00:00Z',
  },

  {
    id: 'BUG-024',
    title: 'SSL certificate validation disabled causing MITM vulnerability',
    description: 'Developer disabled SSL certificate verification to bypass a local dev issue and accidentally committed the change to production. All HTTPS requests silently accept invalid certificates, allowing man-in-the-middle attacks.',
    status: 'resolved',
    priority: 'critical',
    language: 'python',
    errorType: 'SecurityVulnerability',
    tags: ['python', 'ssl', 'security', 'certificate', 'requests', 'mitm', 'https'],
    codeSnippetBefore: `import requests

def call_payment_api(payload):
    # DANGER: SSL verification disabled!
    response = requests.post(
        'https://payments.example.com/charge',
        json=payload,
        verify=False   # Never do this in production
    )
    return response.json()`,
    codeSnippetAfter: `import requests
import certifi

def call_payment_api(payload):
    response = requests.post(
        'https://payments.example.com/charge',
        json=payload,
        verify=certifi.where(),   # Use bundled CA certificates
        timeout=30,
    )
    response.raise_for_status()
    return response.json()`,
    codeSnippetDiff: `  import requests
+ import certifi
  
  def call_payment_api(payload):
      response = requests.post(
          'https://payments.example.com/charge',
          json=payload,
-         verify=False
+         verify=certifi.where(),
+         timeout=30,
      )
+     response.raise_for_status()
      return response.json()`,
    solution: 'Re-enable SSL verification using certifi bundle. For local dev with self-signed certs, add the cert to the trusted store instead of disabling verification. Added timeout and raise_for_status().',
    source: 'manual',
    createdAt: '2024-03-10T08:00:00Z',
    resolvedAt: '2024-03-10T09:00:00Z',
  },

  {
    id: 'BUG-025',
    title: 'IndexError: list index out of range in data parser',
    description: 'Parser assumes every CSV row has at least 5 columns and accesses row[4] directly. Malformed rows or rows with fewer columns cause IndexError, halting the entire import process.',
    status: 'resolved',
    priority: 'medium',
    language: 'python',
    errorType: 'IndexError',
    tags: ['python', 'index-error', 'list', 'csv', 'parsing', 'bounds-check'],
    codeSnippetBefore: `def parse_row(row):
    return {
        'id':    row[0],
        'name':  row[1],
        'email': row[2],
        'age':   row[3],
        'score': row[4],   # IndexError if row has < 5 columns
    }`,
    codeSnippetAfter: `EXPECTED_COLS = 5

def parse_row(row):
    if len(row) < EXPECTED_COLS:
        raise ValueError(
            f"Row has {len(row)} columns, expected {EXPECTED_COLS}: {row}"
        )
    return {
        'id':    row[0].strip(),
        'name':  row[1].strip(),
        'email': row[2].strip(),
        'age':   int(row[3]) if row[3].strip().isdigit() else None,
        'score': float(row[4]) if row[4].strip() else 0.0,
    }`,
    codeSnippetDiff: `+ EXPECTED_COLS = 5
+ 
  def parse_row(row):
+     if len(row) < EXPECTED_COLS:
+         raise ValueError(f"Row has {len(row)} columns, expected {EXPECTED_COLS}")
      return {
-         'id':    row[0],
-         'name':  row[1],
-         'email': row[2],
-         'age':   row[3],
-         'score': row[4],
+         'id':    row[0].strip(),
+         'name':  row[1].strip(),
+         'email': row[2].strip(),
+         'age':   int(row[3]) if row[3].strip().isdigit() else None,
+         'score': float(row[4]) if row[4].strip() else 0.0,
      }`,
    solution: 'Added bounds check before accessing list indices. Added .strip() to clean whitespace. Added safe type conversion with fallback values.',
    source: 'manual',
    createdAt: '2024-03-22T12:00:00Z',
    resolvedAt: '2024-03-22T13:15:00Z',
  },

  {
    id: 'BUG-CPP-109',
    title: 'Inner variable hides outer variable',
    description: 'A local variable inside the block has the same name as the outer variable, so the outer value is not updated as intended.',
    status: 'resolved',
    priority: 'medium',
    language: 'cpp',
    errorType: 'VariableShadowing',
    tags: ['cpp', 'variable-shadowing', 'scope', 'logic-error'],
    codeSnippetBefore: `int count = 10;
if (true) {
    int count = 5;
    cout << count << endl;
}
cout << count << endl;`,
    codeSnippetAfter: `int count = 10;
if (true) {
    count = 5;
    cout << count << endl;
}
cout << count << endl;`,
    codeSnippetDiff: `  int count = 10;
  if (true) {
-     int count = 5;
+     count = 5;
      cout << count << endl;
  }
  cout << count << endl;`,
    solution: 'Removed the inner variable declaration so the original variable gets updated instead of being shadowed.',
    source: 'manual',
    createdAt: '2026-06-09T10:10:00Z',
    resolvedAt: '2026-06-09T10:35:00Z',
  },

  {
    id: 'BUG-CPP-110',
    title: 'Loop condition never changes',
    description: 'The loop variable is not updated inside the loop, so the condition remains true forever and the program gets stuck.',
    status: 'resolved',
    priority: 'critical',
    language: 'cpp',
    errorType: 'InfiniteLoop',
    tags: ['cpp', 'loop', 'infinite-loop', 'control-flow'],
    codeSnippetBefore: `int i = 0;
while (i < 5) {
    cout << i << endl;
}`,
    codeSnippetAfter: `int i = 0;
while (i < 5) {
    cout << i << endl;
    i++;
}`,
    codeSnippetDiff: `  int i = 0;
  while (i < 5) {
      cout << i << endl;
+     i++;
  }`,
    solution: 'Added i++ inside the loop so the condition eventually becomes false and the loop ends.',
    source: 'manual',
    createdAt: '2026-06-10T14:00:00Z',
    resolvedAt: '2026-06-10T14:20:00Z',
  },

  {
    id: 'BUG-CPP-102',
    title: 'Variable used before assignment',
    description: 'A local variable is read without assigning any value first, leading to undefined behavior.',
    status: 'resolved',
    priority: 'critical',
    language: 'cpp',
    errorType: 'UndefinedBehavior',
    tags: ['cpp', 'uninitialized-variable', 'undefined-behavior', 'initialization'],
    codeSnippetBefore: `int x;
if (x > 0) {
    cout << x << endl;
}`,
    codeSnippetAfter: `int x = 0;
if (x > 0) {
    cout << x << endl;
}`,
    codeSnippetDiff: `- int x;
+ int x = 0;
  if (x > 0) {
      cout << x << endl;
  }`,
    solution: 'Initialized the variable before use to avoid undefined behavior.',
    source: 'manual',
    createdAt: '2026-06-02T09:40:00Z',
    resolvedAt: '2026-06-02T10:05:00Z',
  },

  {
    id: 'BUG-CPP-111',
    title: 'Missing semicolon after statement',
    description: 'A C++ statement is missing its terminating semicolon, causing a compile-time syntax error before the next line is parsed.',
    status: 'resolved',
    priority: 'medium',
    language: 'cpp',
    errorType: 'SyntaxError',
    tags: ['cpp', 'syntax-error', 'semicolon', 'compile-error'],
    codeSnippetBefore: `int total = 10
cout << total << endl;`,
    codeSnippetAfter: `int total = 10;
cout << total << endl;`,
    codeSnippetDiff: `- int total = 10
+ int total = 10;
  cout << total << endl;`,
    solution: 'Added the missing semicolon at the end of the variable declaration so the compiler can parse the next statement correctly.',
    source: 'manual',
    createdAt: '2026-06-11T09:15:00Z',
    resolvedAt: '2026-06-11T09:25:00Z',
  },
];

