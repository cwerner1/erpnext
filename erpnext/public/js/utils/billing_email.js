// Copyright (c) 2025, Werner Solutions and contributors
// For license information, please see license.txt

frappe.provide("erpnext.billing_email");

/**
 * Billing Email utilities for auto-filling email recipients with billing contacts.
 *
 * Features:
 * - Auto-fills recipients with billing contact emails (is_billing_contact=1)
 * - Fallback: billing contact → primary contact → party email_id → empty
 * - Supports multiple billing contacts (all emails included)
 * - Auto-selects email template based on is_return (for invoices)
 *
 * Usage:
 *   frappe.ui.form.on("Sales Invoice", {
 *       setup: function(frm) {
 *           erpnext.billing_email.setup(frm, {
 *               party_type: "Customer",
 *               party_field: "customer",
 *               enable_template_selection: true
 *           });
 *       },
 *       customer: function(frm) {
 *           erpnext.billing_email.refresh(frm);
 *       }
 *   });
 */

erpnext.billing_email = {
	/**
	 * Setup billing email hooks for the form.
	 * Call this in the DocType's setup or onload.
	 *
	 * @param {Object} frm - Frappe form object
	 * @param {Object} options - Configuration options
	 * @param {string} options.party_type - "Customer" or "Supplier"
	 * @param {string} options.party_field - Field name containing party (e.g., "customer", "supplier")
	 * @param {boolean} options.enable_template_selection - Auto-select email template based on is_return
	 */
	setup(frm, options) {
		const party_type = options.party_type || "Customer";
		const party_field = options.party_field || (party_type === "Customer" ? "customer" : "supplier");
		const enable_template = options.enable_template_selection !== false;

		// Store config for later use
		frm._billing_email_config = {
			party_type: party_type,
			party_field: party_field,
			enable_template: enable_template,
		};

		// Hook for auto-filling recipients
		frm.events.get_email_recipients = function (frm, fieldname) {
			if (fieldname !== "recipients") return [];

			// Return cached billing contact emails
			if (frm._billing_contact_emails && frm._billing_contact_emails.length > 0) {
				return frm._billing_contact_emails;
			}

			return [];
		};

		// Hook for filtering contact dropdown to show only party's contacts
		frm.events.get_email_recipient_filters = function (frm, fieldname) {
			const config = frm._billing_email_config;
			if (!config) return [];

			const party = frm.doc[config.party_field];
			if (!party) return [];

			// Filter to show contacts linked to this party
			return [
				["Dynamic Link", "link_doctype", "=", config.party_type],
				["Dynamic Link", "link_name", "=", party],
			];
		};
	},

	/**
	 * Refresh billing emails - call after party field changes or on form refresh.
	 *
	 * @param {Object} frm - Frappe form object
	 */
	refresh(frm) {
		const config = frm._billing_email_config;
		if (!config) return;

		const party = frm.doc[config.party_field];
		if (!party) {
			frm._billing_contact_emails = [];
			return;
		}

		// Fetch billing contact emails from server
		frappe.call({
			method: "erpnext.accounts.party.get_billing_contact_emails",
			args: {
				doctype: config.party_type,
				name: party,
			},
			async: false, // Need sync for get_email_recipients hook
			callback: function (r) {
				frm._billing_contact_emails = r.message || [];
			},
		});
	},

	/**
	 * Get email template name based on document type.
	 * For invoices, returns template based on is_return flag.
	 *
	 * @param {Object} frm - Frappe form object
	 * @returns {string|null} Email template name or null
	 */
	get_email_template(frm) {
		const config = frm._billing_email_config;
		if (!config || !config.enable_template) return null;

		// Only for invoice DocTypes
		if (!frm.doc.doctype.includes("Invoice")) return null;

		// Return template based on is_return flag
		if (cint(frm.doc.is_return)) {
			return "Stornorechnung Versand";
		}
		return "Rechnung Versand";
	},

	/**
	 * Open email dialog with billing contact pre-filled and template auto-selected.
	 * Use this to replace the default email action if template selection is needed.
	 *
	 * @param {Object} frm - Frappe form object
	 */
	compose_email(frm) {
		// Ensure billing emails are fetched
		this.refresh(frm);

		const template = this.get_email_template(frm);
		const recipients = frm._billing_contact_emails || [];

		// Create email composer with pre-filled values
		new frappe.views.CommunicationComposer({
			frm: frm,
			recipients: recipients.join(", "),
			email_template: template,
		});
	},
};
