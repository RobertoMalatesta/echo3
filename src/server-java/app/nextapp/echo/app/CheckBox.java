/* 
 * This file is part of the Echo Web Application Framework (hereinafter "Echo").
 * Copyright (C) 2002-2008 NextApp, Inc.
 *
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 */

package nextapp.echo.app;

import nextapp.echo.app.button.DefaultToggleButtonModel;
import nextapp.echo.app.button.ToggleButton;

/**
 * A check box implementation.
 */
public class CheckBox extends ToggleButton {

    /** Serial Version UID. */
    private static final long serialVersionUID = 20070101L;

    /**
     * Creates a check box with no text or icon.
     */
    public CheckBox() {
        this(null, null);
    }
    
    /**
     * Creates a check box with text.
     *
     * @param text the text to be displayed in the check box
     */
    public CheckBox(String text) {
        this(text, null);
    }
    
    /**
     * Creates a check box with an icon.
     *
     * @param icon the icon to be displayed in the check box
     */
    public CheckBox(ImageReference icon) {
        this(null, icon);
    }

    /**
     * Creates a check box with text and an icon.
     *
     * @param text the text to be displayed in the check box
     * @param icon the icon to be displayed in the check box
     */
    public CheckBox(String text, ImageReference icon) {
        super();
        
        setModel(new DefaultToggleButtonModel());
    
        setIcon(icon);
        setText(text);
    }
}
