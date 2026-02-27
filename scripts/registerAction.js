require("dotenv").config();
const axios = require("axios");

const APP_ID      = process.env.HUBSPOT_APP_ID;
const DEV_API_KEY = process.env.HUBSPOT_DEVELOPER_API_KEY;
const BASE_URL    = process.env.APP_BASE_URL;

if (!APP_ID || !DEV_API_KEY || !BASE_URL) {
  console.error("Missing HUBSPOT_APP_ID, HUBSPOT_DEVELOPER_API_KEY, or APP_BASE_URL");
  process.exit(1);
}

// Build property mapping fields (10 pairs = 20 fields)
function buildMappingFields(index, required) {
  return [
    {
      typeDefinition: {
        name: "src_prop_" + index,
        type: "enumeration",
        fieldType: "select",
        optionsUrl: BASE_URL + "/action/fields?name=source_properties"
      },
      supportedValueTypes: ["STATIC_VALUE"],
      isRequired: required
    },
    {
      typeDefinition: {
        name: "tgt_prop_" + index,
        type: "enumeration",
        fieldType: "select",
        optionsUrl: BASE_URL + "/action/fields?name=target_properties"
      },
      supportedValueTypes: ["STATIC_VALUE"],
      isRequired: required
    }
  ];
}

// Generate all 10 mapping pairs
const mappingFields = [];
for (let i = 1; i <= 10; i++) {
  mappingFields.push(...buildMappingFields(i, i <= 1));
}

const actionDefinition = {
  actionUrl: BASE_URL + "/action/execute",
  objectTypes: ["CONTACT", "COMPANY", "DEAL", "TICKET"],
  labels: {
    en: {
      actionName: "Sync Object Properties",
      actionDescription: "Sync property values between associated CRM objects with flexible mapping rules.",
      appDisplayName: "PropBridge",
      inputFieldLabels: {
        source_object_type:   "Source object type",
        target_object_type:   "Target object type",
        association_rule:     "Association rule",
        association_label:    "Association label (if using Specific Label)",
        sync_direction:       "Sync direction",
        skip_if_has_value:    "Skip if target already has a value?",
        src_prop_1:  "Mapping 1 — Source property",  tgt_prop_1:  "Mapping 1 — Target property",
        src_prop_2:  "Mapping 2 — Source property",  tgt_prop_2:  "Mapping 2 — Target property",
        src_prop_3:  "Mapping 3 — Source property",  tgt_prop_3:  "Mapping 3 — Target property",
        src_prop_4:  "Mapping 4 — Source property",  tgt_prop_4:  "Mapping 4 — Target property",
        src_prop_5:  "Mapping 5 — Source property",  tgt_prop_5:  "Mapping 5 — Target property",
        src_prop_6:  "Mapping 6 — Source property",  tgt_prop_6:  "Mapping 6 — Target property",
        src_prop_7:  "Mapping 7 — Source property",  tgt_prop_7:  "Mapping 7 — Target property",
        src_prop_8:  "Mapping 8 — Source property",  tgt_prop_8:  "Mapping 8 — Target property",
        src_prop_9:  "Mapping 9 — Source property",  tgt_prop_9:  "Mapping 9 — Target property",
        src_prop_10: "Mapping 10 — Source property", tgt_prop_10: "Mapping 10 — Target property"
      },
      outputFieldLabels: {
        sync_status:     "Sync status",
        targets_updated: "Targets updated",
        sync_error:      "Error message"
      }
    }
  },
  inputFields: [
    {
      typeDefinition: {
        name: "source_object_type",
        type: "enumeration",
        fieldType: "select",
        options: [
          { label: "Contacts",  value: "contacts"  },
          { label: "Companies", value: "companies" },
          { label: "Deals",     value: "deals"     },
          { label: "Tickets",   value: "tickets"   },
          { label: "Leads",     value: "leads"     },
          { label: "Projects",  value: "projects"  }
        ]
      },
      supportedValueTypes: ["STATIC_VALUE"],
      isRequired: true
    },
    {
      typeDefinition: {
        name: "target_object_type",
        type: "enumeration",
        fieldType: "select",
        options: [
          { label: "Contacts",  value: "contacts"  },
          { label: "Companies", value: "companies" },
          { label: "Deals",     value: "deals"     },
          { label: "Tickets",   value: "tickets"   },
          { label: "Leads",     value: "leads"     },
          { label: "Projects",  value: "projects"  }
        ]
      },
      supportedValueTypes: ["STATIC_VALUE"],
      isRequired: true
    },
    {
      typeDefinition: {
        name: "association_rule",
        type: "enumeration",
        fieldType: "select",
        options: [
          { label: "All associated records",   value: "all"     },
          { label: "Most recently associated", value: "recent"  },
          { label: "First associated",         value: "first"   },
          { label: "Specific label only",      value: "labeled" }
        ]
      },
      supportedValueTypes: ["STATIC_VALUE"],
      isRequired: true
    },
    {
      typeDefinition: {
        name:      "association_label",
        type:      "string",
        fieldType: "text"
      },
      supportedValueTypes: ["STATIC_VALUE"],
      isRequired: false
    },
    {
      typeDefinition: {
        name: "sync_direction",
        type: "enumeration",
        fieldType: "select",
        options: [
          { label: "One-way: source → target",        value: "one_way" },
          { label: "Bidirectional (most recent wins)", value: "two_way" }
        ]
      },
      supportedValueTypes: ["STATIC_VALUE"],
      isRequired: true
    },
    {
      typeDefinition: {
        name: "skip_if_has_value",
        type: "enumeration",
        fieldType: "booleancheckbox",
        options: [
          { label: "Yes — never overwrite existing target values", value: "true"  },
          { label: "No — always overwrite",                        value: "false" }
        ]
      },
      supportedValueTypes: ["STATIC_VALUE"],
      isRequired: false
    },
    ...mappingFields
  ],
  outputFields: [
    { typeDefinition: { name: "sync_status",     type: "string", fieldType: "text" } },
    { typeDefinition: { name: "targets_updated", type: "string", fieldType: "text" } },
    { typeDefinition: { name: "sync_error",      type: "string", fieldType: "text" } }
  ]
};

async function register() {
  const url = "https://api.hubapi.com/automation/v4/actions/" + APP_ID + "?hapikey=" + DEV_API_KEY;
  try {
    const { data } = await axios.post(url, actionDefinition, {
      headers: { "Content-Type": "application/json" }
    });
    console.log("Custom action registered successfully!");
    console.log("Definition ID:", data.id);
    console.log("Action URL:", data.actionUrl);
  } catch (err) {
    const detail = err.response ? err.response.data : err.message;
    console.error("Registration failed:", JSON.stringify(detail, null, 2));
    process.exit(1);
  }
}

register();
