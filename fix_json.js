const fs = require('fs');

let content = fs.readFileSync('flow.json', 'utf8');

// Find all matches of base64 PNGs
const base64Regex = /(?:src|image)[^:]*:\s*\\?"(iVBORw0KGgo[^"\\]+)\\?"/;
const match = content.match(base64Regex);

if (match && match[1]) {
    const base64Str = match[1];
    console.log("Found base64 string of length", base64Str.length);

    const correctJson = {
        "version": "7.3",
        "screens": [
            {
                "id": "PRINT_SETTINGS",
                "title": "Print Settings",
                "terminal": true,
                "success": true,
                "data": {},
                "layout": {
                    "type": "SingleColumnLayout",
                    "children": [
                        {
                            "type": "Image",
                            "src": "data:image/png;base64," + base64Str
                        },
                        {
                            "type": "TextHeading",
                            "text": "Print Settings"
                        },
                        {
                            "type": "TextBody",
                            "text": "Configure your print job. We will generate a payment link once you submit."
                        },
                        {
                            "type": "Dropdown",
                            "label": "Number of Copies",
                            "name": "copies",
                            "required": true,
                            "data-source": [
                                {
                                    "id": "1",
                                    "title": "1 Copy"
                                },
                                {
                                    "id": "2",
                                    "title": "2 Copies"
                                },
                                {
                                    "id": "3",
                                    "title": "3 Copies"
                                },
                                {
                                    "id": "4",
                                    "title": "4 Copies"
                                },
                                {
                                    "id": "5",
                                    "title": "5 Copies"
                                }
                            ]
                        },
                        {
                            "type": "RadioButtonsGroup",
                            "label": "Print Type",
                            "name": "color",
                            "required": true,
                            "data-source": [
                                {
                                    "id": "false",
                                    "title": "Black and White (Rs.2/page)"
                                },
                                {
                                    "id": "true",
                                    "title": "Color (Rs.10/page)"
                                }
                            ]
                        },
                        {
                            "type": "RadioButtonsGroup",
                            "label": "Sides",
                            "name": "sides",
                            "required": true,
                            "data-source": [
                                {
                                    "id": "single",
                                    "title": "Single Sided"
                                },
                                {
                                    "id": "double",
                                    "title": "Double Sided"
                                }
                            ]
                        },
                        {
                            "type": "Footer",
                            "label": "Generate Payment Link",
                            "on-click-action": {
                                "name": "complete",
                                "payload": {
                                    "copies": "${form.copies}",
                                    "color": "${form.color}",
                                    "sides": "${form.sides}"
                                }
                            }
                        }
                    ]
                }
            }
        ]
    };

    fs.writeFileSync('flow.json', JSON.stringify(correctJson, null, 2));
    console.log("Successfully rebuilt flow.json");
} else {
    console.log("Could not find the base64 string. The match was:", match);
    const snippet = content.substring(0, 1000);
    console.log("Snippet:", snippet);
}
