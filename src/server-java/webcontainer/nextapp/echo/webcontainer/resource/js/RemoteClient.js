/**
 * @fileoverview
 * Remote Client Implementation.
 * 
 * Requires: Core, Serial, WebCore, Application, Render.
 */

/**
 * @class 
 * A client which provides a remote view of an Echo application being executed on the server.
 * This client exchanges data with the remote server in the form of XML messages containing
 * serialized components and events.
 *        
 * Component synchronization peers that will be working exclusively with a RemoteClient may 
 * implement an optional <code>storeProperty(clientMessage, property)</code> method to 
 * provide custom property XML serialization.  This should be avoided if possible, but may
 * be necessary for serializing certain information such as the state of a model.
 */
EchoRemoteClient = Core.extend(EchoClient, {
    
    $static: {
        
        /**
         * Base URL from which libraries should be retrieved.
         * Libraries are loaded into global scope, and are thus not
         * bound to any particular client instance.
         * 
         * @type String
         */
        libraryServerUrl: null
    },
    
    /**
     * The base server url.
     * @type String
     * @private
     */
    _serverUrl: null,
    
    /**
     * Flag indicating whether a client-server transaction is currently in progres.
     * @type Boolean
     * @private
     */
    _transactionInProgress: false,
    
    /**
     * Identifier for input restriction registered with client during transactions.
     * @private
     */
    _inputRestrictionId: null,

    /**
     * Function wrapper to invoke _processClientUpdate() method.
     * @type Function
     * @private
     */
    _processClientUpdateRef: null,
    
    /**
     * Function wrapper to invoke _processClientEvent() method.
     * @type Function
     * @private
     */
    _processClientEventRef: null,
    
    /**
     * Associative array mapping between shorthand URL codes and replacement values.
     * @private
     */
    _urlMappings: null,
    
    /**
     * Queue of commands to be executed.  Each command occupies two
     * indices, first index is the command peer, second is the command data.
     * @type Array
     * @private
     */
    _commandQueue: null,
    
    /**
     * Outgoing client message.
     * @type EchoRemoteClient.ClientMessage
     * @private
     */
    _clientMessage: null,
    
    /**
     * AsyncManager instance which will invoke server-pushed operations.
     * @type EchoRemoteClient.AsyncManager
     * @private
     */
    _asyncManager: null,
    
    /**
     * Wait indicator.
     * @type EchoRemoteClient.WaitIndicator
     * @private
     */
    _waitIndicator: null,
    
    /**
     * Network delay before raising wait indicator, in milleseconds.
     * @type Integer
     * @private
     */
    _preWaitIndicatorDelay: 500,
    
    /**
     * Runnable that will trigger initialization of wait indicator.
     * @type WebCore.Scheduler.Runnable
     * @private
     */
    _waitIndicatorRunnable: null,
    
    /**
     * Flag indicating whether the remote client has been initialized.
     */
    _initialized: false,
    
    /**
     * Creates a new RemoteClient instance.
     * @constructor
     * @param serverUrl the URL of the server
     */
    $construct: function(serverUrl) {
        WebCore.init();
    
        EchoClient.call(this);
        
        this._serverUrl = serverUrl;
        this._processClientUpdateRef = Core.method(this, this._processClientUpdate);
        this._processClientEventRef = Core.method(this, this._processClientEvent);
        this._urlMappings = {};
        this._urlMappings.I = this._serverUrl + "?sid=Echo.Image&iid=";
        this._commandQueue = null;
        this._clientMessage = new EchoRemoteClient.ClientMessage(this, true);
        this._asyncManager = new EchoRemoteClient.AsyncManager(this);
        this._waitIndicator = new EchoRemoteClient.DefaultWaitIndicator();
        this._waitIndicatorRunnable = new WebCore.Scheduler.MethodRunnable(Core.method(this, this._waitIndicatorActivate), 
                this._preWaitIndicatorDelay, false);
    },
    
    /**
     * Adds a listener for an arbitrary event type to a component.
     * This method is invoked by the Serial module when event tags are
     * processed during the deserialization of component synchronization
     * XML messages.
     * 
     * @param {EchoApp.Component} component the component on which the listener should be added
     * @param {String} eventType the type of event
     */
    addComponentListener: function(component, eventType) {
        component.addListener(eventType, this._processClientEventRef);
    },
    
    /**
     * Decompresses a shorthand URL into a valid full-length URL.
     * A shorthand URL is expressed as "!A!xxxx" where
     * "A" is a key whose value contains the first portion of the URL
     * and "xxxx" is the latter portion of the URL.  Such URLs are used
     * to reduce the amount of bandwidth used in transmitting large
     * numbers of the same URL from server-to-client.
     *
     * @param url the shorthand URL to process
     * @return the full-length valid URL
     * @type String
     */
    decompressUrl: function(url) {
        var urlTokens = url.split("!");
        if (urlTokens[0]) {
            // urlTokens[0] is not empty: URL is not a shorthand URL.
            return url;
        } else {
            // urlTokens[0] = empty
            // urlTokens[1] = key
            // urlTokens[2] = baseUrl
            if (urlTokens.length != 3) {
                throw new IllegalArgumentException("Invalid encoded URL");
            }
            var replacementValue = this._urlMappings[urlTokens[1]]; 
            if (replacementValue == null) {
                throw new Error("Invalid URL shorthand key \"" + urlTokens[1] + "\".");
            }
            return replacementValue + urlTokens[2];
        }
    },
    
    /**
     * Enqueues a command to be processed after component synchronization has been completed.
     * 
     * @param commandPeer the command peer to execute
     * @param commandData an object containing the command data sent from the server
     * @private
     */
    _enqueueCommand: function(commandPeer, commandData) {
        if (this._commandQueue == null) {
            this._commandQueue = new Array();
        }
        this._commandQueue.push(commandPeer, commandData);
    },
    
    /**
     * Executes all enqued commands; empties the queue.
     * @private
     */
    _executeCommands: function() {
        if (this._commandQueue) {
            for (var i = 0; i < this._commandQueue.length; i += 2) {
                this._commandQueue[i].execute(this, this._commandQueue[i + 1]);
            }
            this._commandQueue = null;
        }
    },
    
    /**
     * @see EchoClient#getDefaultImage
     */
    getDefaultImage: function(imageName) {
        return new EchoApp.ImageReference(this._serverUrl + "?sid=Echo.Image&iid=" + imageName);
    },
    
    /**
     * Returns the URL of a library service based on the serviceId.
     * 
     * @param serviceId the serviceId
     * @return the full library URL
     * @type String
     * @private
     */
    _getLibraryServiceUrl: function(serviceId) {
        if (!EchoRemoteClient._libraryServerUrl) {
            EchoRemoteClient._libraryServerUrl = this._serverUrl;
        }
        return EchoRemoteClient._libraryServerUrl + "?sid=" + serviceId;
    },
    
    /**
     * @see EchoClient#getServiceUrl
     */
    getServiceUrl: function(serviceId) {
        return this._serverUrl + "?sid=" + serviceId;
    },
    
    /**
     * Initializes the remote client.  This method will perform the following operations:
     * <ul>
     *  <li>Find the domain element in which the application should exist by parsing the
     *   initial server message XML document.</li>
     *  <li>Create a new EchoApp.Application instance,</li>
     *  <li>Register a component update listener on that application instance such that
     *   a user's input will be stored in the outgoing ClientMessage.</li>
     *  <li>Invoke EchoClient.configure() to initialize the client.</li>
     * </ul>  
     * 
     * @param {Document} initialResponseDocument the initial ServerMessage XML document 
     *        received from the server (this document contains some necessary start-up information
     *        such as the id of the root element)
     */
    init: function(initialResponseDocument) {
        // Find domain element.
        var domainElementId = initialResponseDocument.documentElement.getAttribute("root");
        var domainElement = document.getElementById(domainElementId);
        if (!domainElement) {
            throw new Error("Cannot find domain element: " + domainElementId);
        }
        
        // Create an application instance.
        var application = new EchoApp.Application();
        
        // Register an update listener to receive notification of user actions such that they
        // may be remarked in the outgoing ClientMessage.
        application.addComponentUpdateListener(this._processClientUpdateRef);
        
        // Perform general purpose client configuration.
        this.configure(application, domainElement);
        
        // Mark the client as initialized.
        this._initialized = true;
    },
    
    /**
     * Processes an event from a component that requires immediate server interaction.
     * 
     * @param e the event to process
     */
    _processClientEvent: function(e) {
        if (this._transactionInProgress) {
            if (new Date().getTime() - this._syncInitTime > 2000) {
                //FIXME Central error handling for these.
                alert("Waiting on server response.  Press the browser reload or refresh button if server fails to respond.");
            }
            return;
        }
        this._clientMessage.setEvent(e.source.renderId, e.type, e.data);
        this.sync();
    },
    
    /**
     * Processes a user update to a component (storing the updated state in the outgoing
     * client message).
     * 
     * @param e the property update event from the component
     */
    _processClientUpdate: function(e) {
        if (this._transactionInProgress) {
            //FIXME need to work on scenarios where clientmessage is null, for both this and events too.
            return;
        }
        
        var stored = false;
        if (e.parent.peer.storeProperty) {
            stored = e.parent.peer.storeProperty(this._clientMessage, e.propertyName);
        }
        if (!stored) {
            this._clientMessage.storeProperty(e.parent.renderId, e.propertyName, e.newValue);
        }
    },
    
    /**
     * ServerMessage completion listener.
     * 
     * @param e the server message completion event
     */
    _processSyncComplete: function(e) {
        // Mark time of serialization completion with profiling timer.
        if (EchoClient.profilingTimer) {
            EchoClient.profilingTimer.mark("ser");
        }
        
        // Flag transaction as being complete.
        this._transactionInProgress = false;
        this.removeInputRestriction(this._inputRestrictionId);
        
        // Register component update listener 
        this.application.addComponentUpdateListener(this._processClientUpdateRef);
    	EchoRender.processUpdates(this);
        
        this._executeCommands();
        
        if (this._focusedComponent) {
            this.application.setFocusedComponent(this._focusedComponent);
        }
    
        if (EchoClient.profilingTimer) {
            Core.Debug.consoleWrite(EchoClient.profilingTimer);
            EchoClient.profilingTimer = null;
        }
        
        if (this._waitIndicatorActive) {
            this._waitIndicatorActive = false;
            this._waitIndicator.deactivate();
        }
    },
    
    /**
     * Process a response to a client-server synchronization.
     * 
     * @param e the HttpConnection response event
     */
    _processSyncResponse: function(e) {
        // Remove wait indicator from scheduling (if wait indicator has not been presented yet, it will not be).
        WebCore.Scheduler.remove(this._waitIndicatorRunnable);
        
        // Retrieve response document.
        var responseDocument = e.source.getResponseXml();
        
        // Verify that response document exists and is valid.
        if (!e.valid || !responseDocument || !responseDocument.documentElement) {
            //FIXME Central error handling for things like this.
            //FIXME Shut down further client input with secondary "you're beating a dead horse" error message. 
            var msg = "An invalid response was received from the server";
            if (e.exception) {
            	msg += ": " + e.exception;
            } else if (e.source.getResponseText()) {
            	msg += ": \"" + e.source.getResponseText() + "\"";
            }
            msg += ". Press the browser reload or refresh button.";
            alert(msg);
            return;
        }
        
        // If this is the first ServerMessage received, initialize the client
        // This step will create the application, determine where in the DOM the application should be
        // rendered, and so forth.
        if (!this._initialized) {
            this.init(responseDocument);
        }
        
        // Profiling Timer (Uncomment to enable, comment to disable).
        EchoClient.profilingTimer = new EchoClient.Timer();
        
        // Remove component update listener from application.  This listener is listening
        // for user input.  
        this.application.removeComponentUpdateListener(this._processClientUpdateRef);
        
        // Create new ServerMessage object with response document.
        var serverMessage = new EchoRemoteClient.ServerMessage(this, responseDocument);
        
        // Add completion listener to invoke _processSyncComplete when message has been fully processed.
        // (Some elements of the server message are processed asynchronously). 
        serverMessage.addCompletionListener(Core.method(this, this._processSyncComplete));
        
        // Start server message processing.
        serverMessage.process();
    },
    
    /**
     * Removes a listener for an arbitrary event type to a component.
     * 
     * @param {EchoApp.Component} component the component from which the listener should be removed
     * @param {String} eventType the type of event
     */
    removeComponentListener: function(component, eventType) {
        component.removeListener(eventType, this._processClientEventRef);
    },
    
    /**
     * Sets the wait indicator that will be displayed when a client-server action takes longer than
     * a specified period of time.
     * 
     * @param {EchoRemoteClient.WaitIndicator} waitIndicator the new wait indicator 
     */
    setWaitIndicator: function(waitIndicator) {
        if (this._waitIndicator) {
            this._waitIndicator.deactivate();
        }
        this._waitIndicator = waitIndicator;
    },
    
    /**
     * Initiates a client-server synchronization.
     */
    sync: function() {
        if (this._transactionInProgress) {
            throw new Error("Attempt to invoke client/server synchronization while another transaction is in progress."); 
        }
        WebCore.Scheduler.add(this._waitIndicatorRunnable);
    
        this._transactionInProgress = true;
        this._inputRestrictionId = this.createInputRestriction(true);
    
        this._asyncManager._stop();    
        this._syncInitTime = new Date().getTime();
        var conn = new WebCore.HttpConnection(this.getServiceUrl("Echo.Sync"), "POST", 
                this._clientMessage._renderXml(), "text/xml");
        
        // Create new client message.
        this._clientMessage = new EchoRemoteClient.ClientMessage(this, false);

        conn.addResponseListener(Core.method(this, this._processSyncResponse));
        conn.connect();
    },
    
    /**
     * Activates the wait indicator.
     * @private
     */
    _waitIndicatorActivate: function() {
        this._waitIndicatorActive = true;
        this._waitIndicator.activate();
    }
});

/**
 * Manages server-pushed updates to the client. 
 */
EchoRemoteClient.AsyncManager = Core.extend({

    /**
     * The supported client.
     *
     * @type EchoRemoteClient
     * @private
     */
    _client: null,
    
    /**
     * The repeating runnable used for server polling.
     *
     * @type WebCore.Scheduler.Runnable
     * @private 
     */
    _runnable: null,

    /** 
     * Creates a new asynchronous manager.
     *
     * @param {EchoRemoteClient} client the supported cilent
     */
    $construct: function(client) {
        this._client = client;
        this._runnable = new WebCore.Scheduler.MethodRunnable(Core.method(this, this._pollServerForUpdates), 1000, false);
    },
    
    /**
     * Creates and invokes a new HttpConnection to the server to poll the server and determine whether
     * it has any updates that need to be pushed to the client.
     */
    _pollServerForUpdates: function() {
        var conn = new WebCore.HttpConnection(this._client.getServiceUrl("Echo.AsyncMonitor"), "GET");
        conn.addResponseListener(Core.method(this, this._processPollResponse));
        conn.connect();
    },
    
    /**
     * Response processor for server polling request.
     * In the event a server action is required, this method will submit the client message to the 
     * server immediately.  The server will push any updates into the reciprocated server message.
     * If no action is required, the next polling interval will be scheduled.
     * 
     * @param e the poll response event 
     */
    _processPollResponse: function(e) {
        var responseDocument = e.source.getResponseXml();
        if (!e.valid || !responseDocument || !responseDocument.documentElement) {
            //FIXME Central error handling for things like this.
            //FIXME Shut down further client input with secondary "you're beating a dead horse" error message. 
            var msg = "An invalid response was received from the server";
            if (e.exception) {
                msg += ": " + e.exception;
            } else if (e.source.getResponseText()) {
                msg += ": \"" + e.source.getResponseText() + "\"";
            }
            msg += ". Press the browser reload or refresh button.";
            alert(msg);
            return;
        }
        
        if (responseDocument.documentElement.getAttribute("request-sync") == "true") {
            this._client.sync();
        } else {
            WebCore.Scheduler.add(this._runnable);
        }
    },
    
    /**
     * Sets the interval at which the server should be polled.
     * 
     * @param interval the new polling interval, in milleseconds
     */
    _setInterval: function(interval) {
        this._runnable.timeInterval = interval;
    },
    
    /**
     * Starts server polling for asynchronous tasks.
     */
    _start: function() {
        WebCore.Scheduler.add(this._runnable);
    },
    
    /**
     * Stops server polling for asynchronous tasks.
     */
    _stop: function() {
        WebCore.Scheduler.remove(this._runnable);
    }
});

/**
 * Client-to-server synchronization message.
 * This object is used to collect state changes on the client and then
 * render an XML version to be POSTed to a server-side Echo application.
 */
EchoRemoteClient.ClientMessage = Core.extend({

    $static: {
    
        /**
         * @class Utility class for constructing the client properties directive.
         * @private
         */
        _ClientProperties: Core.extend({
        
            _element: null,
            
            _clientMessage: null,

            /**        
             * Creates a new ClientProperties directive object.
             * @param clientMessage the client message object
             */
            $construct: function(clientMessage) {
                this._element = clientMessage._document.createElement("dir");
                this._element.setAttribute("proc", "ClientProperties");
                clientMessage._document.documentElement.appendChild(this._element);
                this._clientMessage = clientMessage;
            },
            
            /**
             * Constructs a property element with the given key-value pair and adds that to the 
             * client properties directive in the client message.
             * 
             * @param key the key
             * @param value the value
             */
            _add: function(key, value) {
                var element = this._clientMessage._document.createElement("p");
                element.setAttribute("n", key);
                EchoSerial.storeProperty(this._clientMessage._client, element, value);
                this._element.appendChild(element);
            }
        })
    },
    
    /**
     * The RemoteClient which generated this message.
     * @type {EchoRemoteClient}
     * @private
     */
    _client: null,
    
    /**
     * Mapping between component ids and updated property values.
     * Values in this map are updated by the storeProperty() method.
     * These values will be rendered to XML when required.
     * @type {Object}
     * @private
     */
    _componentIdToPropertyMap: null,

    /**
     * Id of the component which fired the event that is responsible for
     * the client message being sent to the server.
     * @type String
     * @private
     */
    _eventComponentId: null,
    
    /**
     * Type of event fired to cause server interaction.
     * @type String
     * @private
     */
    _eventType: null,
    
    /**
     * Event data object of event responsible for server interaction.
     * @type Object
     * @private
     */
    _eventData: null,
    
    /**
     * The DOM object to which the client message will be rendered.
     * @type Docuemnt
     * @private
     */
    _document: null,

    /**
     * Creates a new client message.
     *
     * @param client the RemoteClient
     * @param initialize flag indicating whether this is the initial client message, which will 
     *        gather data about the client environment
     */
    $construct: function(client, initialize) {
        this._client = client;
        this._componentIdToPropertyMap = {};
        
        this._document = WebCore.DOM.createDocument("http://www.nextapp.com/products/echo/svrmsg/clientmessage.3.0", "cmsg");
        if (initialize) {
            this._document.documentElement.setAttribute("t", "init");
            this._renderClientProperties();
        }
    },
    
    /**
     * Queries the application for the currently focused component and renders
     * this information to the client message DOM.
     *
     * @private
     */
    _renderCFocus: function() {
        if (!this._client.application) {
            return;
        }
        var focusedComponent = this._client.application.getFocusedComponent();
        if (focusedComponent && focusedComponent.renderId.substring(0,2) == "c_") {
            var cFocusElement = this._document.createElement("dir");
            cFocusElement.setAttribute("proc", "CFocus");
            var focusElement = this._document.createElement("focus");
            focusElement.setAttribute("i", focusedComponent.renderId);
            cFocusElement.appendChild(focusElement);
            this._document.documentElement.appendChild(cFocusElement);
        }
    },
    
    /**
     * Renders compoennt hierarchy state change information to the client message DOM.
     * This information is retrieved from instance variables of the client message object,
     * i.e., the component-id-to-property-value map and event properties.  
     * @private
     */
    _renderCSync: function() {
        var cSyncElement = this._document.createElement("dir");
        cSyncElement.setAttribute("proc", "CSync");
        
        // Render event information.
        if (this._eventType) {
            var eElement = this._document.createElement("e");
            eElement.setAttribute("t", this._eventType);
            eElement.setAttribute("i", this._eventComponentId);
            if (this._eventData != null) {
                EchoSerial.storeProperty(this._client, eElement, this._eventData);
            }
            cSyncElement.appendChild(eElement);
        }
        
        // Render property information.
        for (var componentId in this._componentIdToPropertyMap) {
            var propertyMap = this._componentIdToPropertyMap[componentId];
            var component = this._client.application.getComponentByRenderId(componentId);
            var peerClass = EchoRender.getPeerClass(component);
            for (var propertyName in propertyMap) {
                var propertyValue = propertyMap[propertyName];
                var pElement = this._document.createElement("p");
                pElement.setAttribute("i", componentId);
                pElement.setAttribute("n", propertyName);
                EchoSerial.storeProperty(this._client, pElement, propertyValue);
                cSyncElement.appendChild(pElement);
            }
        }
        
        this._document.documentElement.appendChild(cSyncElement);
    },
    
    /**
     * Renders information about the client environment to the client message DOM.
     * This information is rendered only in the first client message to the server.
     *
     * @private
     */
    _renderClientProperties: function() {
        var cp = new EchoRemoteClient.ClientMessage._ClientProperties(this);
        
        cp._add("screenWidth", screen.width);
        cp._add("screenHeight", screen.height);
        cp._add("screenColorDepth", screen.colorDepth);
        cp._add("utcOffset", 0 - parseInt((new Date()).getTimezoneOffset()));
        
        cp._add("navigatorAppName", window.navigator.appName);
        cp._add("navigatorAppVersion", window.navigator.appVersion);
        cp._add("navigatorAppCodeName", window.navigator.appCodeName);
        cp._add("navigatorCookieEnabled", window.navigator.cookieEnabled);
        cp._add("navigatorJavaEnabled", window.navigator.javaEnabled());
        cp._add("navigatorLanguage", window.navigator.language ? window.navigator.language : window.navigator.userLanguage);
        cp._add("navigatorPlatform", window.navigator.platform);
        cp._add("navigatorUserAgent", window.navigator.userAgent);
        
        var env = WebCore.Environment;
        cp._add("browserOpera", env.BROWSER_OPERA);
        cp._add("browserSafari", env.BROWSER_SAFARI);
        cp._add("browserKonqueror", env.BROWSER_KONQUEROR);
        cp._add("browserMozillaFirefox", env.BROWSER_FIREFOX);
        cp._add("browserMozilla", env.BROWSER_MOZILLA);
        cp._add("browserInternetExplorer", env.BROWSER_INTERNET_EXPLORER);
        cp._add("browserVersionMajor", env.BROWSER_MAJOR_VERSION);
        cp._add("browserVersionMinor", env.BROWSER_MINOR_VERSION);
    },
    
    /**
     * Renders all information to the XML DOM and returns it.
     * 
     * @return the DOM
     * @type Document
     * @private
     */
    _renderXml: function() {
        if (!this._rendered) {
            this._renderCFocus();
            this._renderCSync();
            this._rendered = true;
        }
        return this._document;
    },
    
    /**
     * Sets the event that will cause the client-server interaction.
     *
     * @param {String} componentId the renderId of the event-firing component
     * @param {String} eventType the type of the event
     * @param {Object} the event data object
     */
    setEvent: function(componentId, eventType, eventData) {
        this._eventComponentId = componentId;
        this._eventType = eventType;
        this._eventData = eventData;
    },
    
    /**
     * Stores information about a property change to a component.
     *
     * @param {String} componentId the renderId of the component
     * @param {String} propertyName the name of the property
     * @param {Object} the new property value
     */
    storeProperty: function(componentId, propertyName, propertyValue) {
        var propertyMap = this._componentIdToPropertyMap[componentId];
        if (!propertyMap) {
            propertyMap = {};
            this._componentIdToPropertyMap[componentId] = propertyMap;
        }
        propertyMap[propertyName] = propertyValue;
    }
});

/**
 * Namespace for built-in command execution peers.
 */
EchoRemoteClient.CommandExec = { };

/**
 * SerevrMessage directive processor for command executions.
 */
EchoRemoteClient.CommandExecProcessor = Core.extend({

    $static: {
    
        _typeToPeerMap: {},
        
        /**
         * Registers a command execution peer.
         *
         * @param {String} type the command type name
         * @param commandPeer an object providing an 'execute()' method which be invoked to execute the command.
         */
        registerPeer: function(type, commandPeer) {
            EchoRemoteClient.CommandExecProcessor._typeToPeerMap[type] = commandPeer;
        }
    },

    $construct: function(client) { 
        this._client = client;
    },
    
    /**
     * Directive processor process() implementation.
     */
    process: function(dirElement) {
        var cmdElement = dirElement.firstChild;
        while (cmdElement) {
            var type = cmdElement.getAttribute("t");
            var commandPeer = EchoRemoteClient.CommandExecProcessor._typeToPeerMap[type];
            if (!commandPeer) {
    	        throw new Error("Peer not found for: " + type);
            }
            var commandData = {};
            var pElement = cmdElement.firstChild;
            while (pElement) {
                EchoSerial.loadProperty(this._client, pElement, null, commandData, null);
                pElement = pElement.nextSibling;
            }
            this._client._enqueueCommand(commandPeer, commandData);
            cmdElement = cmdElement.nextSibling;
        }
    }
});

/**
 * ServerMessage directive processor for component focus.
 */
EchoRemoteClient.ComponentFocusProcessor = Core.extend({

    _client: null,

    $construct: function(client) { 
        this._client = client;
    },
    
    /**
     * Directive processor process() implementation.
     */
    process: function(dirElement) {
        var element = dirElement.firstChild;
        while (element) {
            if (element.nodeType == 1) {
                switch (element.nodeName) {
                   case "focus": this._processFocus(element); break;
                }
            }
            element = element.nextSibling;
        }
    },
    
    _processFocus: function(focusElement) {
        this._client._focusedComponent = this._client.application.getComponentByRenderId(focusElement.getAttribute("i"));
    }
});

/**
 * ServerMessage directive processor for component synchronizations (remove phase).
 */
EchoRemoteClient.ComponentSyncRemoveProcessor = Core.extend({

    _client: null,

    $construct: function(client) { 
        this._client = client;
    },
    
    process: function(dirElement) {
        var rmElement = dirElement.firstChild;
        while (rmElement) {
            if (rmElement.nodeType != 1) {
                continue;
            }
            
            // Determine parent component.
            var parentComponent;
            if (rmElement.getAttribute("r") == "true") {
                parentComponent = this._client.application.rootComponent;
            } else {
                var parentId = rmElement.getAttribute("i");
                parentComponent = this._client.application.getComponentByRenderId(parentId);
            }
    
            // Retrive child ids and remove.
            var childElementIds = rmElement.getAttribute("rm").split(",");
            this._processComponentRemove(parentComponent, childElementIds);
            
            rmElement = rmElement.nextSibling;
        }
    },
    
    _processComponentRemove: function(parentComponent, childElementIds) {
        if (childElementIds.length > 5) {
            // Special case: many children being removed: create renderId -> index map and remove by index
            // in order to prevent Component.indexOf() of from being invoked n times.
            
            // Create map between ids and indices.
            var idToIndexMap = {};
            for (var i = 0; i < parentComponent.children.length; ++i) {
                idToIndexMap[parentComponent.children[i].renderId] = i;
            }
            
            // Create array of indices to remove.
            var indicesToRemove = new Array();
            for (var i = 0; i <  childElementIds.length; ++i) {
                var index = idToIndexMap[childElementIds[i]];
                if (index != null) {
                    indicesToRemove.push(parseInt(index));
                }
            }
            indicesToRemove.sort(EchoRemoteClient.ComponentSyncUpdateProcessor._numericReverseSort);
    
            // Remove components (last to first).
            for (var i = 0; i < indicesToRemove.length; ++i) {
                parentComponent.remove(indicesToRemove[i]);
            }
        } else {
            for (var i = 0; i < childElementIds.length; ++i) {
                var component = this._client.application.getComponentByRenderId(childElementIds[i]);
                if (component) {
                    parentComponent.remove(component);
                }
            }
        }
    }
});

/**
 * ServerMessage directive processor for component synchronizations (update phase).
 */
EchoRemoteClient.ComponentSyncUpdateProcessor = Core.extend({

    $static: {
        
        _numericReverseSort: function(a, b) {
            return b - a;
        }
    },

    _referenceMap : null,
    
    $construct: function(client) { 
        this._client = client;
    },
    
    /**
     * Directive processor process() implementation.
     */
    process: function(dirElement) {
        var element;
        
        element = dirElement.firstChild;
        while (element) {
            if (element.nodeType == 1) {
                switch (element.nodeName) {
                case "fr": this._processFullRefresh(element); break;
                case "ss": this._processStyleSheet(element); break;
                case "up": this._processUpdate(element); break;
                case "sp": this._processStoreProperties(element); break;
                }
            }
            element = element.nextSibling;
        }
    },
    
    _processFullRefresh: function(frElement) {
        this._client.application.rootComponent.removeAll();
    },
    
    _processStoreProperties: function(spElement) {
        var propertyElement = spElement.firstChild;
        while (propertyElement) {
            switch (propertyElement.nodeName) {
            case "rp": // Referenced Property
                var propertyId = propertyElement.getAttribute("i");
                var propertyType = propertyElement.getAttribute("t");
                var translator = EchoSerial.getPropertyTranslator(propertyType);
                if (!translator) {
                    throw new Error("Translator not available for property type: " + propertyType);
                }
                propertyValue = translator.toProperty(this._client, propertyElement);
                if (!this._referenceMap) {
                    this._referenceMap = {};
                }
                this._referenceMap[propertyId] = propertyValue;
                break;
            }
            propertyElement = propertyElement.nextSibling;
        }
    },
    
    _processStyleSheet: function(ssElement) {
        var styleSheet = EchoSerial.loadStyleSheet(this._client, ssElement);
        this._client.application.setStyleSheet(styleSheet);
    },
    
    _processUpdate: function(upElement) {
        // Determine parent component
        var parentComponent;
        if (upElement.getAttribute("r") == "true") {
            parentComponent = this._client.application.rootComponent;
        } else {
            var parentId = upElement.getAttribute("i");
            parentComponent = this._client.application.getComponentByRenderId(parentId);
        }
    
        var styleName = upElement.getAttribute("s");
        if (styleName != null) {
            parentComponent.setStyleName(styleName == "" ? null : styleName); //FIXME verify this works as desired for unsets.
        }
    
        var enabledState = upElement.getAttribute("en");
        if (enabledState) {
            parentComponent.setEnabled(enabledState == "true");
        }
    
        var element = upElement.firstChild;
        
        // Child insertion cursor index (if index is omitted, children are added at this position).
        var cursorIndex = 0;
        
        while (element) {
            if (element.nodeType == 1) {
                switch (element.nodeName) {
                case "c": // Added child.
                    var component = EchoSerial.loadComponent(this._client, element, this._referenceMap);
                    var index = element.getAttribute("x");
                    if (index == null) {
                        // No index specified, add children at current insertion cursor position.
                        parentComponent.add(component, cursorIndex);
                        ++cursorIndex;
                    } else {
                        // Index specified, add child at index, set insertion cursor position to index + 1.
                        index = parseInt(index);
                        parentComponent.add(component, index);
                        cursorIndex = index + 1;
                    }
                    break;
                case "p": // Property update.
                    EchoSerial.loadProperty(this._client, element, parentComponent, null, this._referenceMap);
                    break;
                case "e": // Event update.
                    var eventType = element.getAttribute("t");
                    if (element.getAttribute("v") == "true") {
                        this._client.removeComponentListener(parentComponent, eventType);
                        this._client.addComponentListener(parentComponent, eventType);
                    } else {
                        this._client.removeComponentListener(parentComponent, eventType);
                    }
                    break;
                }
            }
            element = element.nextSibling;
        }
    }
});

EchoRemoteClient.ServerMessage = Core.extend({

    $static: {
    
        _processorClasses: { },
        
        addProcessor: function(name, processor) {
            this._processorClasses[name] = processor;
        }
    },

    $construct: function(client, xmlDocument) { 
        this.client = client;
        this.document = xmlDocument;
        this._listenerList = new Core.ListenerList();
        this._processorInstances = { };
    },
    
    addCompletionListener: function(l) {
        this._listenerList.addListener("completion", l);
    },
    
    process: function() {
        // Processing phase 1: load libraries.
        var libsElement = WebCore.DOM.getChildElementByTagName(this.document.documentElement, "libs");
        if (libsElement) {
            var libraryGroup = new WebCore.Library.Group();
            var element = libsElement.firstChild;
            while (element) {
                if (element.nodeType == 1) {
                    if (element.nodeName == "lib") {
                        var url = this.client._getLibraryServiceUrl(element.getAttribute("i"));
                        libraryGroup.add(url);
                    }
                }
                element = element.nextSibling;
            }
            if (libraryGroup.hasNewLibraries()) {
                libraryGroup.addLoadListener(Core.method(this, this._processPostLibraryLoad));
                libraryGroup.load();
            } else {
                this._processPostLibraryLoad();
            }
        } else {
            this._processPostLibraryLoad();
        }
    },
    
    _processPostLibraryLoad: function() {
        EchoClient.profilingTimer.mark("lib"); // Library Loading
        // Processing phase 2: invoke directives.
        var groupElements = WebCore.DOM.getChildElementsByTagName(this.document.documentElement, "group");
        for (var i = 0; i < groupElements.length; ++i) {
            var dirElements = WebCore.DOM.getChildElementsByTagName(groupElements[i], "dir");
            for (var j = 0; j < dirElements.length; ++j) {
                var procName = dirElements[j].getAttribute("proc");
                var processor = this._processorInstances[procName];
                if (!processor) {
                    // Create new processor instance.
                    if (!EchoRemoteClient.ServerMessage._processorClasses[procName]) {
                        throw new Error("Invalid processor specified in ServerMessage: " + procName);
                    }
                    processor = new EchoRemoteClient.ServerMessage._processorClasses[procName](this.client);
                    this._processorInstances[procName] = processor;
                }
                processor.process(dirElements[j]);
            }
        }
    
        // Complete: notify listeners of completion.
        this._listenerList.fireEvent({type: "completion", source: this});
        
        // Start server push listener if required.
        if (this.document.documentElement.getAttribute("async-interval")) {
            this.client._asyncManager._setInterval(parseInt(this.document.documentElement.getAttribute("async-interval")));
            this.client._asyncManager._start();
        }
    },
    
    removeCompletionListener: function(l) {
        this._listenerList.removeListener("completion", l);
    }
});

/**
 * Wait indicator base class.
 */
EchoRemoteClient.WaitIndicator = Core.extend({

    $construct: function() { },

    $abstract: {
        
        /**
         * Wait indicator activation method.  Invoked when the wait indicator should be activated.
         */
        activate: function() { },
        
        /**
         * Wait indicator deactivation method.  Invoked when the wait indicator should be deactivated.
         */
        deactivate: function() { }
    }
});

/**
 * @class Default wait indicator implementation.
 */
EchoRemoteClient.DefaultWaitIndicator = Core.extend(EchoRemoteClient.WaitIndicator, {

    $construct: function() {
        this._divElement = document.createElement("div");
        this._divElement.style.cssText = "display: none; z-index: 32767; position: absolute; top: 30px; right: 30px; width: 200px;"
                 + " padding: 20px; border: 1px outset #abcdef; background-color: #abcdef; color: #000000; text-align: center;";
        this._divElement.appendChild(document.createTextNode("Please wait..."));
        this._fadeRunnable = new WebCore.Scheduler.MethodRunnable(Core.method(this, this._tick), 50, true);
        document.body.appendChild(this._divElement);
    },
    
    activate: function() {
        this._divElement.style.display = "block";
        WebCore.Scheduler.add(this._fadeRunnable);
        this._opacity = 0;
    },
    
    deactivate: function() {
        this._divElement.style.display = "none";
        WebCore.Scheduler.remove(this._fadeRunnable);
    },
    
    _tick: function() {
        ++this._opacity;
        // Formula explained:
        // this._opacity starts at 0 and is incremented forever.
        // First operation is to modulo by 40 then subtract 20, result ranges from -20 to 20.
        // Next take the absolute value, result ranges from 20 to 0 to 20.
        // Divide this value by 30, so the range goes from 2/3 to 0 to 2/3.
        // Subtract that value from 1, so the range goes from 1/3 to 1 and back.
        var opacityValue = 1 - ((Math.abs((this._opacity % 40) - 20)) / 30);
        if (!WebCore.Environment.PROPRIETARY_IE_OPACITY_FILTER_REQUIRED) {
    	    this._divElement.style.opacity = opacityValue;
        }
    }
});

EchoRemoteClient.ServerMessage.addProcessor("CFocus", EchoRemoteClient.ComponentFocusProcessor);
EchoRemoteClient.ServerMessage.addProcessor("CSyncUp", EchoRemoteClient.ComponentSyncUpdateProcessor);
EchoRemoteClient.ServerMessage.addProcessor("CSyncRm", EchoRemoteClient.ComponentSyncRemoveProcessor);
EchoRemoteClient.ServerMessage.addProcessor("CmdExec", EchoRemoteClient.CommandExecProcessor);