export function normalizeSavedBuildRecord(record) {
  if (!record || typeof record !== 'object') {
    return {
      buildData: {},
      ramStickCount: 2,
    };
  }

  const raw = record.build_data && typeof record.build_data === 'object' ? record.build_data : {};
  const { __ramStickCount, ...buildData } = raw;
  const parsedCount = Number(__ramStickCount);

  return {
    buildData,
    ramStickCount: Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 2,
  };
}

export function validatePreorderInput({ customerName = '', contactNumber = '' } = {}) {
  const cleanName = String(customerName || '').trim();
  const cleanContact = String(contactNumber || '').trim();

  if (!cleanName) {
    return { valid: false, error: 'Customer full name is required.' };
  }

  const digitsOnly = cleanContact.replace(/\D/g, '');
  if (digitsOnly.length < 7) {
    return { valid: false, error: 'Please enter a valid contact number.' };
  }

  return {
    valid: true,
    customerName: cleanName,
    contactNumber: cleanContact,
  };
}

export function buildPreorderRequestPayload({
  currentUser = null,
  customerName = '',
  contactNumber = '',
  email = '',
  product = null,
}) {
  const item = product || {};
  const resolvedEmail =
    String(email || '').trim() || (currentUser?.email ? String(currentUser.email).trim() : '');

  return {
    user_id: currentUser ? currentUser.id : null,
    customer_name: String(customerName || '').trim(),
    contact_number: String(contactNumber || '').trim(),
    email: resolvedEmail,
    product_id: String(item.id || item.sku_code || ''),
    product_name: String(item.name || 'Unnamed Component'),
    estimated_price: Number(item.price || 0),
    status: 'Pending Supplier Confirmation',
  };
}